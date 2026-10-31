// api/notify.js — deadline reminders + weekly digest per person, sent with Resend.
// POST {mode, preview: true} returns the emails without sending (the confirmation step).
// POST {mode, names: [...]} sends to the confirmed people. GET ?mode=... is Vercel Cron (needs CRON_SECRET).
import { createClient } from '@supabase/supabase-js';
import { guard, fromCron } from './_guard.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

const DAY = 86400000;
const todayIST = () =>
  new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10); // YYYY-MM-DD in IST
const daysUntil = d => Math.round((new Date(d) - new Date(todayIST())) / DAY);
const key = s => (s || '').trim().toLowerCase();
const esc = s =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function dueLabel(d) {
  if (!d) return 'no deadline';
  const n = daysUntil(d);
  if (n < 0) return `overdue by ${-n} day${n === -1 ? '' : 's'}`;
  if (n === 0) return 'due today';
  if (n === 1) return 'due tomorrow';
  return `due in ${n} days (${d})`;
}

function taskRows(tasks) {
  return tasks
    .map(
      t => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #ddd6c8">${esc(t.task)}
          <div style="font-size:12px;color:#6f6a60">${esc(t.meetings?.title || '')}</div></td>
        <td style="padding:8px 0;border-bottom:1px solid #ddd6c8;text-align:right;font-size:13px;
          color:${t.deadline && daysUntil(t.deadline) < 0 ? '#a3341a' : '#1c1b19'}">${dueLabel(t.deadline)}
          ${/^https:\/\/trello\.com\//.test(t.trello_url || '') ? `<br><a href="${esc(t.trello_url)}" style="color:#1c1b19;font-size:12px">Open in Trello</a>` : ''}</td>
      </tr>`
    )
    .join('');
}

function wrap(name, heading, body) {
  return `<div style="font-family:Arial,sans-serif;background:#f4f1ea;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #ddd6c8;border-radius:12px;padding:24px">
      <div style="font-size:11px;letter-spacing:.08em;color:#6f6a60">MEETING → EXECUTION</div>
      <h2 style="font-family:Georgia,serif;font-weight:400;margin:8px 0 16px">${esc(heading)}</h2>
      <p style="margin:0 0 16px">Hi ${esc(name)},</p>
      ${body}
      <p style="font-size:12px;color:#6f6a60;margin-top:24px">Sent by your Meeting → Execution agent.</p>
    </div></div>`;
}

async function sendEmail(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'Meeting Agent <onboarding@resend.dev>',
      to,
      subject,
      html,
    }),
  });
  if (!r.ok) throw new Error(await r.text());
}

export default async function handler(req, res) {
  // Scheduled runs (GET) must carry the cron secret; app buttons (POST) must come from the app
  if (req.method === 'GET') {
    if (!fromCron(req)) return res.status(401).json({ error: 'Scheduled runs need a valid CRON_SECRET' });
  } else if (!guard(req, res, { methods: ['POST'] })) return;
  const mode = req.method === 'GET' ? req.query.mode : req.body?.mode;
  const preview = req.method === 'POST' && req.body?.preview === true;
  const only = req.method === 'POST' && Array.isArray(req.body?.names)
    ? new Set(req.body.names.map(key)) : null;
  if (!['reminders', 'digest'].includes(mode)) return res.status(400).json({ error: 'mode must be reminders or digest' });
  if (!preview && !process.env.RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY is not set' });

  const { data: people, error: pErr } = await supabase.from('people').select('name, email');
  if (pErr) return res.status(500).json({ error: pErr.message });
  const { data: tasks, error: tErr } = await supabase
    .from('action_items')
    .select('task, owner, deadline, status, trello_url, meetings(title)')
    .neq('status', 'done')
    .order('deadline', { ascending: true, nullsFirst: false });
  if (tErr) return res.status(500).json({ error: tErr.message });
  if (!Array.isArray(tasks)) return res.status(500).json({ error: 'Could not read tasks' });

  // Decisions from the last 7 days, and the older ones they replaced
  let fresh = [], replaced = [];
  if (mode === 'digest') {
    const since = new Date(Date.now() - 7 * DAY).toISOString();
    const { data } = await supabase
      .from('decisions')
      .select('id, text, made_by, status, meetings(title)')
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    fresh = (data || []).filter(d => d.status === 'active');
    if (fresh.length) {
      const { data: old } = await supabase
        .from('decisions')
        .select('text, superseded_by')
        .in('superseded_by', fresh.map(d => d.id));
      replaced = old || [];
    }
  }

  const byPerson = new Map((people || []).map(p => [key(p.name), p]));
  const sent = [], skipped = [], failed = [], emails = [];
  const unmatched = [...new Set(tasks.filter(t => t.owner && !byPerson.has(key(t.owner))).map(t => t.owner))];

  for (const p of people || []) {
    if (only && !only.has(key(p.name))) continue;
    const mine = tasks.filter(t => key(t.owner) === key(p.name));
    let subject, html;

    if (mode === 'reminders') {
      const urgent = mine.filter(t => t.deadline && daysUntil(t.deadline) <= 2);
      if (!urgent.length) { skipped.push(p.name); continue; }
      const overdue = urgent.filter(t => daysUntil(t.deadline) < 0).length;
      subject = overdue
        ? `${overdue} overdue task${overdue > 1 ? 's' : ''} — and what's due next`
        : `Reminder: ${urgent.length} task${urgent.length > 1 ? 's' : ''} due soon`;
      html = wrap(p.name, 'Coming up on your plate',
        `<table style="width:100%;border-collapse:collapse">${taskRows(urgent)}</table>`);
    } else {
      const overdue = mine.filter(t => t.deadline && daysUntil(t.deadline) < 0);
      const open = mine.filter(t => !overdue.includes(t));
      const changes = fresh.map(d => {
        const prev = replaced.find(r => r.superseded_by === d.id);
        return `<li style="margin-bottom:6px">${esc(d.text)}${
          prev ? ` <span style="color:#a3341a;font-size:13px">(replaces: <s>${esc(prev.text)}</s>)</span>` : ''
        }</li>`;
      }).join('');
      subject = `Your weekly digest — ${mine.length} open task${mine.length === 1 ? '' : 's'}`;
      html = wrap(p.name, 'Your week, from every meeting',
        (overdue.length ? `<h3 style="font-size:14px;color:#a3341a">Overdue</h3>
          <table style="width:100%;border-collapse:collapse">${taskRows(overdue)}</table>` : '') +
        `<h3 style="font-size:14px">Open tasks</h3>` +
        (open.length ? `<table style="width:100%;border-collapse:collapse">${taskRows(open)}</table>`
          : `<p style="color:#6f6a60">Nothing open. Nice.</p>`) +
        (changes ? `<h3 style="font-size:14px">Decisions this week</h3><ul style="padding-left:18px">${changes}</ul>` : ''));
    }

    if (preview) {
      emails.push({ name: p.name, email: p.email, subject, html, count: mine.length });
      continue;
    }
    try {
      await sendEmail(p.email, subject, html);
      sent.push(p.name);
    } catch (e) {
      failed.push({ name: p.name, error: e.message });
    }
    await sleep(600); // Resend free tier: max 2 emails per second
  }

  if (preview) return res.json({ mode, emails, skipped, unmatched });
  res.json({ mode, sent, skipped, failed, unmatched });
}
