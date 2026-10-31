// api/transcript-status.js — polled by the app until the transcript is ready
import { guard } from './_guard.js';

export default async function handler(req, res) {
  if (!guard(req, res, { methods: ['GET'] })) return;
  const { id } = req.query;
  // AssemblyAI ids are letters, digits and dashes. Anything else could reach other API paths with our key.
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid transcript id.' });
  }
  try {
    const r = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.status === 'error') return res.status(502).json({ error: data.error || 'Transcription failed.' });
    if (data.status !== 'completed') return res.json({ status: data.status });
    const utterances = (data.utterances || []).map(u => ({ speaker: u.speaker, text: u.text }));
    res.json({ status: 'completed', utterances });
  } catch {
    res.status(502).json({ error: 'Could not reach the transcription service.' });
  }
}
