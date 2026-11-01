// api/reminders.js — called every minute by Supabase (pg_cron) with the CRON_SECRET.
// Sends reminders that are due, plus one morning nudge per person about overdue items.
// Also picks up any entry whose transcript finished but wasn't finalized (e.g. a missed webhook).
import { fromCron, adminClient } from './_guard.js';
import { sendPush, localNow, finalizeEntry } from './_pipeline.js';

const fmtTime = t => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`;
};

export default async function handler(req, res) {
  if (!fromCron(req)) return res.status(401).json({ error: 'Unauthorized' });
  const admin = adminClient();
  if (!admin) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set' });
  res.json(await runReminders(admin));
}

export async function runReminders(admin, now = new Date()) {
  const stats = { reminders: 0, nudges: 0, finalized: 0 };

  // 1) Reminders that are due (skip anything more than a day late, e.g. after downtime)
  const { data: due } = await admin.from('items')
    .select('id, user_id, title, kind, due_date, due_time, owner')
    .eq('status', 'open').is('reminded_at', null)
    .lte('remind_at', now.toISOString()).gte('remind_at', new Date(now - 86400000).toISOString())
    .limit(200);
  for (const it of due || []) {
    // Mark first so a slow send can't cause a double reminder next minute
    const { data: claimed } = await admin.from('items').update({ reminded_at: now.toISOString() })
      .eq('id', it.id).is('reminded_at', null).select('id').maybeSingle();
    if (!claimed) continue;
    const when = it.due_time ? `at ${fmtTime(it.due_time.slice(0, 5))}` : 'today';
    await sendPush(admin, it.user_id, {
      title: it.kind === 'event' ? it.title : `Reminder: ${it.title}`,
      body: it.owner ? `Waiting on ${it.owner} · due ${when}` : `${it.kind === 'event' ? 'Starts' : 'Due'} ${when}`,
      url: `/?item=${it.id}`, tag: `item-${it.id}`,
    });
    stats.reminders++;
  }

  // 2) Morning nudge about overdue items, at each person's all-day reminder hour
  const { data: people } = await admin.from('profiles').select('id, timezone, allday_hour');
  for (const p of people || []) {
    const local = localNow(p.timezone);
    if (Number(local.time.slice(0, 2)) < p.allday_hour) continue;
    const { data: late } = await admin.from('items').select('id, title')
      .eq('user_id', p.id).eq('status', 'open').lt('due_date', local.date).is('nudged_at', null).limit(50);
    if (!late?.length) continue;
    const ids = late.map(l => l.id);
    await admin.from('items').update({ nudged_at: now.toISOString() }).in('id', ids);
    await sendPush(admin, p.id, {
      title: late.length === 1 ? `Overdue: ${late[0].title}` : `${late.length} things are overdue`,
      body: late.length === 1 ? 'Tap to reschedule or mark it done.' : late.slice(0, 3).map(l => l.title).join(' · '),
      url: '/?tab=tasks', tag: 'overdue',
    });
    stats.nudges++;
  }

  // 3) Safety net: finish recordings whose webhook never arrived (older than 2 minutes)
  const { data: stuck } = await admin.from('entries').select('id').eq('status', 'processing').not('job_id', 'is', null)
    .lt('created_at', new Date(now - 120000).toISOString()).limit(5);
  for (const e of stuck || []) {
    const r = await finalizeEntry(admin, e.id);
    if (r.ok) stats.finalized++;
  }
  return stats;
}
