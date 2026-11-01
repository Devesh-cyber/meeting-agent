// api/process.js — drives an entry through transcription and minutes.
//   { entryId, action: "start" }      after the audio is uploaded
//   { entryId, action: "check" }      the app polls this; finishes the entry if the transcript is ready
//   { entryId, action: "retry" }      a failed entry
//   { entryId, action: "rerun" }      rewrite the minutes from the existing transcript (e.g. after naming speakers)
import { requireUser, adminClient } from './_guard.js';
import { startTranscription, finalizeEntry, transcriptStatus } from './_pipeline.js';

export default async function handler(req, res) {
  const who = await requireUser(req, res);
  if (!who) return;
  const admin = adminClient();
  if (!admin) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set' });
  const { entryId, action = 'check' } = req.body || {};

  // Read through the user's own client: security rules prove the entry is theirs
  const { data: entry } = await who.db.from('entries').select('id, status, job_id, audio_path, transcript, kind').eq('id', entryId).maybeSingle();
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  try {
    if (action === 'start' || (action === 'retry' && !entry.job_id)) {
      if (!entry.audio_path) return res.status(400).json({ error: 'This entry has no recording' });
      if (entry.job_id && action === 'start') return res.json({ status: entry.status });
      const jobId = await startTranscription(admin, { ...entry, audio_path: entry.audio_path });
      await admin.from('entries').update({ job_id: jobId, status: 'processing', error: null }).eq('id', entry.id);
      return res.json({ status: 'processing' });
    }
    if (action === 'retry') {
      if (Array.isArray(entry.transcript) && entry.transcript.length) {
        const r = await finalizeEntry(admin, entry.id, { reuseTranscript: true });
        return res.json({ status: r.ok ? 'ready' : 'failed', error: r.error });
      }
      const t = await transcriptStatus(entry.job_id);
      if (t.status === 'error') {
        // The old job is dead: start a fresh one
        const jobId = await startTranscription(admin, entry);
        await admin.from('entries').update({ job_id: jobId, status: 'processing', error: null }).eq('id', entry.id);
        return res.json({ status: 'processing' });
      }
      await admin.from('entries').update({ status: 'processing', error: null }).eq('id', entry.id);
    }
    if (action === 'rerun') {
      const r = await finalizeEntry(admin, entry.id, { reuseTranscript: true });
      return res.json({ status: r.ok ? 'ready' : r.skipped ? entry.status : 'failed', error: r.error });
    }
    // check (and the tail of retry)
    const { data: now } = await admin.from('entries').select('status').eq('id', entry.id).single();
    if (now.status !== 'processing') return res.json({ status: now.status });
    const r = await finalizeEntry(admin, entry.id);
    return res.json({ status: r.ok ? 'ready' : r.pending || r.skipped ? 'processing' : 'failed', error: r.error });
  } catch (e) {
    await admin.from('entries').update({ status: 'failed', error: String(e.message).slice(0, 300) }).eq('id', entry.id);
    return res.status(502).json({ error: e.message });
  }
}
