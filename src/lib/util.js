import { supabase } from './supabase';

// ---------- dates (always the phone's local calendar) ----------
export const iso = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const today = () => iso(new Date());
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
export const daysFrom = (s, base = today()) => Math.round((new Date(s + 'T00:00:00') - new Date(base + 'T00:00:00')) / 86400000);
export const dayLabel = s => {
  const n = daysFrom(s);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
};
export const shortDate = s => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const fmtTime = t => {
  if (!t) return '';
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`;
};
export const clock = ts => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const dateOf = ts => iso(new Date(ts));
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
export const duration = s => (!s ? '' : s < 60 ? `${s}s` : `${Math.round(s / 60)} min`);
export const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; } catch { return 'Asia/Kolkata'; } };

// Sort key for items on a day: timed first by time, then all-day
export const byWhen = (a, b) =>
  (a.due_date || '9999').localeCompare(b.due_date || '9999') ||
  (a.due_time || '99').localeCompare(b.due_time || '99') ||
  a.title.localeCompare(b.title);

export const isOverdue = it => it.status === 'open' && it.due_date && daysFrom(it.due_date) < 0;

// ---------- API ----------
export async function authHeader() {
  const { data } = await supabase.auth.getSession();
  return data.session ? { authorization: `Bearer ${data.session.access_token}` } : {};
}

export async function post(url, body) {
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('You seem to be offline. Check your connection and try again.');
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = typeof d.error === 'string' ? d.error : d.error?.message;
    throw new Error(msg || (r.status === 504 ? 'That took too long. Try again.' : `Something went wrong (${r.status}).`));
  }
  return d;
}

// Upload audio into your private folder; returns the storage path
export async function uploadAudio(userId, blob) {
  if (!blob?.size) throw new Error('The recording came out empty. Try again and record for a few seconds.');
  const type = (blob.type || 'audio/webm').split(';')[0];
  const ext = blob.name ? blob.name.split('.').pop().replace(/[^a-z0-9]/gi, '').slice(0, 5) : (type.split('/')[1] || 'webm');
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || 'webm'}`;
  const { error } = await supabase.storage.from('audio').upload(path, blob, { contentType: type });
  if (error) throw new Error(error.message?.includes('mime') ? 'That file type isn’t supported. Use an audio file.' : 'Upload failed. Try again.');
  return path;
}

export const safeUrl = u => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);
