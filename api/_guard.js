// api/_guard.js — shared request checks. Files starting with "_" are not deployed as routes.

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

// Groq JSON call with a clean error instead of a crash when the model misbehaves
export async function groqJSON(prompt, temperature = 0.1) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      temperature,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message || `Groq error ${r.status}`);
  try {
    return JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } catch {
    throw new Error('The AI returned an unreadable answer. Try again.');
  }
}
