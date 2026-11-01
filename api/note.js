// api/note.js — "Note to self": you say or type it, it becomes tasks and calendar items straight away.
//   { text }        typed or dictated (e.g. with Wispr Flow)
//   { audioPath }   a short voice note already uploaded to your audio folder
import { requireUser, adminClient, clip } from './_guard.js';
import { parseNote, cleanItem, localNow, transcribeNote } from './_pipeline.js';

export default async function handler(req, res) {
  const who = await requireUser(req, res);
  if (!who) return;
  const { db, user } = who;
  let { text, audioPath } = req.body || {};

  try {
    if (audioPath) {
      if (typeof audioPath !== 'string' || audioPath.split('/')[0] !== user.id) return res.status(400).json({ error: 'That recording isn’t yours' });
      const admin = adminClient();
      if (!admin) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set' });
      text = await transcribeNote(admin, audioPath);
    }
    text = clip(text, 4000).trim();
    if (!text) return res.status(400).json({ error: 'I didn’t catch anything. Try again.' });

    const [{ data: profile }, { data: categories }] = await Promise.all([
      db.from('profiles').select('*').eq('id', user.id).single(),
      db.from('categories').select('id, name').order('sort'),
    ]);
    const out = await parseNote({ profile, categories: categories || [], text, now: localNow(profile?.timezone) });
    const parsed = (Array.isArray(out.items) ? out.items : []).filter(i => i?.title).slice(0, 20).map(i => cleanItem(i, categories || []));

    const { data: entry, error: eErr } = await db.from('entries').insert({
      user_id: user.id, kind: 'note', title: clip(out.title || text, 80), note_text: text,
      audio_path: audioPath || null, status: 'ready', summary: null,
      category_id: parsed.find(i => i.category_id)?.category_id || null,
    }).select('id, title').single();
    if (eErr) throw new Error('Could not save the note');

    let items = [];
    if (parsed.length) {
      const { data, error } = await db.from('items')
        .insert(parsed.map(i => ({ ...i, user_id: user.id, entry_id: entry.id, status: 'open' })))
        .select('*');
      if (error) throw new Error('Could not add the items');
      items = data;
    }
    res.json({ entry, items, text });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
