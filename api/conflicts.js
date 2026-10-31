export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { newDecisions, pastDecisions } = req.body;
  if (!newDecisions?.length || !pastDecisions?.length) return res.json({ conflicts: [] });

  const past = pastDecisions
    .map(p => `[${p.id}] ${p.text} (by ${p.made_by || 'unknown'}, ${p.created_at.slice(0, 10)})`)
    .join('\n');
  const fresh = newDecisions.map((d, i) => `(${i}) ${d.text}`).join('\n');

  const prompt = `You check new meeting decisions against earlier decisions stored in memory.
A conflict means the new decision contradicts, reverses, or changes an earlier one: a different date, tool, owner, scope, or a cancellation.
The same decision restated is NOT a conflict. Unrelated topics are NOT conflicts.

Earlier decisions:
${past}

New decisions:
${fresh}

Return ONLY JSON:
{"conflicts":[{"new_index": number, "past_id": string, "kind": "contradiction"|"change", "explanation": string}]}
explanation = one short sentence saying exactly what changed. Return {"conflicts":[]} if there are none.`;

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await r.json();
  if (!r.ok) return res.status(500).json({ error: data.error });

  const out = JSON.parse(data.choices[0].message.content);
  const ids = new Set(pastDecisions.map(p => p.id));
  const conflicts = (out.conflicts || []).filter(
    c => ids.has(c.past_id) && newDecisions[c.new_index]
  );
  res.json({ conflicts });
}