// api/_guard.js — shared request checks. Files starting with "_" are not deployed as routes.
import { createClient } from '@supabase/supabase-js';

const SB_URL = () => (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');

// Supabase client that acts as the signed-in user, so database security rules apply
export function userClient(token) {
  return createClient(SB_URL(), process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Admin client for scheduled jobs only (bypasses security rules). Needs SUPABASE_SERVICE_ROLE_KEY.
export function adminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SB_URL(), process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Checks the app origin AND a valid signed-in user. Returns { user, db } or null (response already sent).
export async function requireUser(req, res, opts = {}) {
  if (!guard(req, res, opts)) return null;
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ error: 'Sign in first' }); return null; }
  const db = userClient(token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) { res.status(401).json({ error: 'Your session expired. Sign in again.' }); return null; }
  return { user: data.user, db };
}

// Only accept calls made by this app's own pages (same host), or local development.
export function fromOurApp(req) {
  const host = req.headers.host || '';
  const src = req.headers.origin || req.headers.referer || '';
  if (!src) return false;
  try {
    const h = new URL(src).host;
    return h === host || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h);
  } catch {
    return false;
  }
}

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set.
export function fromCron(req) {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.authorization === `Bearer ${secret}`;
}

// Returns true if the request may continue; otherwise sends the error response.
export function guard(req, res, { methods = ['POST'], cron = false } = {}) {
  if (!methods.includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }
  if (cron && fromCron(req)) return true;
  if (!fromOurApp(req)) {
    res.status(403).json({ error: 'Requests must come from the app' });
    return false;
  }
  return true;
}

export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));
export const clip = (s, n) => String(s ?? '').slice(0, n);

// Groq JSON call with a clean error instead of a crash when the model misbehaves.
// The model occasionally writes slightly broken JSON and Groq rejects it ("Failed to validate JSON"),
// so retry, and as a last resort ask without JSON mode and pull the object out of the text.
function parseLoose(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* try harder */ }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  const chunk = text.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1'); // drop trailing commas
  try { return JSON.parse(chunk); } catch { return null; }
}

async function groqOnce(prompt, temperature, jsonMode) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      temperature,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (r.ok) return { out: parseLoose(data.choices?.[0]?.message?.content) };
  // Groq hands back the rejected text; it's often usable
  const failed = data.error?.failed_generation;
  if (failed) return { out: parseLoose(failed) };
  return { err: data.error?.message || `Groq error ${r.status}`, status: r.status };
}

export async function groqJSON(prompt, temperature = 0.1) {
  const attempts = [[temperature, true], [0, true], [0, false]];
  let lastErr = 'The AI returned an unreadable answer. Try again.';
  for (const [t, jsonMode] of attempts) {
    const p = jsonMode ? prompt : `${prompt}\n\nReply with the JSON object only. No markdown, no explanation.`;
    const { out, err, status } = await groqOnce(p, t, jsonMode);
    if (out && typeof out === 'object') return out;
    if (err) {
      lastErr = err;
      if (status === 401 || status === 403 || status === 429) break; // retrying won't help
    }
  }
  throw new Error(/validate JSON/i.test(lastErr) ? 'The AI returned an unreadable answer. Try again.' : lastErr);
}
