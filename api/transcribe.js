export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { audioUrl } = req.body;
  const r = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      authorization: process.env.ASSEMBLYAI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ audio_url: audioUrl, speaker_labels: true }),
  });
  const data = await r.json();
  if (!r.ok) return res.status(500).json({ error: data.error });
  res.json({ id: data.id });
}