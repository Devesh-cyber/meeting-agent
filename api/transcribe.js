// api/transcribe.js — starts an AssemblyAI job with speaker labels
import { guard } from './_guard.js';

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { audioUrl } = req.body || {};

  // Only transcribe files from our own Supabase recordings bucket
  const allowed = `${(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/recordings/`;
  if (typeof audioUrl !== 'string' || !process.env.VITE_SUPABASE_URL || !audioUrl.startsWith(allowed)) {
    return res.status(400).json({ error: 'Audio must come from the app’s recordings storage.' });
  }

  try {
    const r = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        authorization: process.env.ASSEMBLYAI_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ audio_url: audioUrl, speaker_labels: true }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: data.error || `Transcription service error ${r.status}` });
    res.json({ id: data.id });
  } catch {
    res.status(502).json({ error: 'Could not reach the transcription service.' });
  }
}
