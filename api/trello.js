// api/trello.js — creates one Trello card per confirmed action item
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { items, meetingTitle } = req.body; // [{id, task, owner, deadline}]
  const { TRELLO_KEY, TRELLO_TOKEN, TRELLO_LIST_ID } = process.env;
  if (!TRELLO_KEY || !TRELLO_TOKEN || !TRELLO_LIST_ID) {
    return res.status(500).json({ error: 'Trello is not configured' });
  }

  const auth = `key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`;
  const cards = [];

  for (const it of items || []) {
    const body = {
      idList: TRELLO_LIST_ID,
      name: it.owner ? `${it.task} · ${it.owner}` : it.task,
      desc:
        `Owner: ${it.owner || 'Unassigned'}\n` +
        `From meeting: ${meetingTitle}\n` +
        `Created by the Meeting → Execution agent after human confirmation.`,
      pos: 'bottom',
    };
    if (it.deadline) body.due = `${it.deadline}T18:00:00+05:30`;

    const r = await fetch(`https://api.trello.com/1/cards?${auth}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      cards.push({ id: it.id, error: await r.text() });
      continue;
    }
    const c = await r.json();
    cards.push({ id: it.id, url: c.shortUrl });
  }

  res.json({ cards });
}