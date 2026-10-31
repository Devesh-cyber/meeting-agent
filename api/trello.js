// api/trello.js — keeps Trello in sync with confirmed tasks.
// action "create" (default): one card per item. "update": rename / re-date a card. "archive": close a card.
import { guard, isDate, clip } from './_guard.js';

const cardId = url => {
  const m = typeof url === 'string' && url.match(/^https:\/\/trello\.com\/c\/([A-Za-z0-9]{6,12})(\/|$)/);
  return m ? m[1] : null;
};
const cardName = it => (it.owner ? `${clip(it.task, 300)} · ${clip(it.owner, 60)}` : clip(it.task, 300));

export default async function handler(req, res) {
  if (!guard(req, res)) return;
  const { TRELLO_KEY, TRELLO_TOKEN, TRELLO_LIST_ID } = process.env;
  if (!TRELLO_KEY || !TRELLO_TOKEN || !TRELLO_LIST_ID) {
    return res.status(500).json({ error: 'Trello is not configured' });
  }
  const auth = `key=${encodeURIComponent(TRELLO_KEY)}&token=${encodeURIComponent(TRELLO_TOKEN)}`;
  const { action = 'create', items, item, meetingTitle } = req.body || {};

  if (action === 'update' || action === 'archive') {
    const id = cardId(item?.trello_url);
    if (!id) return res.status(400).json({ error: 'No Trello card linked to this task' });
    const body = action === 'archive'
      ? { closed: true }
      : { name: cardName(item), due: isDate(item.deadline) ? `${item.deadline}T18:00:00+05:30` : null };
    const r = await fetch(`https://api.trello.com/1/cards/${id}?${auth}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return res.status(502).json({ error: `Trello error ${r.status}` });
    return res.json({ ok: true });
  }

  if (!Array.isArray(items) || !items.length) return res.json({ cards: [] });
  const cards = [];
  for (const it of items.slice(0, 50)) {
    if (!it?.task) continue;
    const body = {
      idList: TRELLO_LIST_ID,
      name: cardName(it),
      desc:
        `Owner: ${clip(it.owner || 'Unassigned', 60)}\n` +
        `From meeting: ${clip(meetingTitle, 200)}\n` +
        `Created by Minutes after human confirmation.`,
      pos: 'bottom',
    };
    if (isDate(it.deadline)) body.due = `${it.deadline}T18:00:00+05:30`;
    try {
      const r = await fetch(`https://api.trello.com/1/cards?${auth}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) { cards.push({ id: it.id, error: `Trello error ${r.status}` }); continue; }
      const c = await r.json();
      cards.push({ id: it.id, url: c.shortUrl });
    } catch {
      cards.push({ id: it.id, error: 'Could not reach Trello' });
    }
  }
  res.json({ cards });
}
