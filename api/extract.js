export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { transcript, meetingDate } = req.body; // [{speaker, text}]
  const lines = transcript.map(u => `${u.speaker}: ${u.text}`).join('\n');

  const base = new Date(meetingDate + 'T00:00:00Z');
  const calendar = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    const day = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    return `${day} = ${d.toISOString().slice(0, 10)}`;
  }).join('\n');

  const prompt = `You extract structured outcomes from meeting transcripts.
Use this calendar to resolve relative deadlines. The first line is the meeting day.
"By Monday" means the first Monday AFTER the meeting day.
${calendar}

Return ONLY JSON:
{"summary": string,
 "decisions": [{"text": string, "made_by": string|null}],
 "action_items": [{"task": string, "owner": string|null, "deadline": "YYYY-MM-DD"|null}]}
Only include things actually agreed. Never invent owners.
For each decision, set made_by to the name of the speaker who stated or confirmed it.
Do not repeat a decision as an action item unless a specific person was asked to do work for it.
If a deadline is mentioned in any form (a weekday, "tomorrow", "next week", "end of month"), you MUST convert it to YYYY-MM-DD using the calendar above. Use null only when no time at all is mentioned.

Transcript:
${lines}`;

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await r.json();
  if (!r.ok) return res.status(500).json({ error: data.error });
  res.json(JSON.parse(data.choices[0].message.content));
}