export default async function handler(req, res) {
  const { id } = req.query;
  const r = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
    headers: { authorization: process.env.ASSEMBLYAI_API_KEY },
  });
  const data = await r.json();
  if (data.status === 'error') return res.status(500).json({ error: data.error });
  if (data.status !== 'completed') return res.json({ status: data.status });
  const utterances = (data.utterances || []).map(u => ({
    speaker: u.speaker, text: u.text,
  }));
  res.json({ status: 'completed', utterances });
}