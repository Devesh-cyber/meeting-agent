// api/push.js — register this phone/laptop for reminders, remove it, or send a test.
//   { action: "subscribe", subscription, device }   { action: "unsubscribe", endpoint }   { action: "test" }
import { requireUser, adminClient, clip } from './_guard.js';
import { sendPush } from './_pipeline.js';

export default async function handler(req, res) {
  const who = await requireUser(req, res);
  if (!who) return;
  const { db, user } = who;
  const { action, subscription, endpoint, device } = req.body || {};

  if (action === 'subscribe') {
    const s = subscription || {};
    if (typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    const admin = adminClient();
    if (!admin) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set' });
    // A browser can switch accounts: the newest sign-in owns this device
    await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint).neq('user_id', user.id);
    const { error } = await db.from('push_subscriptions').upsert({
      user_id: user.id, endpoint: s.endpoint, p256dh: clip(s.keys.p256dh, 200), auth: clip(s.keys.auth, 100), device: clip(device, 80),
    }, { onConflict: 'endpoint' });
    if (error) return res.status(500).json({ error: 'Could not save this device' });
    return res.json({ ok: true });
  }
  if (action === 'unsubscribe') {
    await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
    return res.json({ ok: true });
  }
  if (action === 'test') {
    const admin = adminClient();
    if (!admin) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set' });
    const r = await sendPush(admin, user.id, { title: 'Reminders are on', body: 'This is how your reminders will look.', url: '/', tag: 'test' });
    if (r.skipped) return res.status(500).json({ error: r.skipped });
    return res.json(r);
  }
  res.status(400).json({ error: 'Unknown action' });
}
