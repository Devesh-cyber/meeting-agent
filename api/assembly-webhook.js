// api/assembly-webhook.js — AssemblyAI calls this when a transcript is ready,
// so your minutes are written (and you're notified) even if the app is closed.
import { adminClient } from './_guard.js';
import { finalizeEntry, webhookSecret } from './_pipeline.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = webhookSecret();
  if (!secret || req.headers['x-minutes-secret'] !== secret) return res.status(401).json({ error: 'Unauthorized' });
  const id = req.body?.transcript_id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) return res.status(400).json({ error: 'Bad transcript id' });
  const admin = adminClient();
  if (!admin) return res.status(500).json({ error: 'Not configured' });
  const { data: entry } = await admin.from('entries').select('id').eq('job_id', id).maybeSingle();
  if (!entry) return res.json({ ok: true, ignored: true });
  const r = await finalizeEntry(admin, entry.id);
  res.json({ ok: true, ...r });
}
