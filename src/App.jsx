import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import './App.css';

/* ---------- helpers ---------- */
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
const label = s => (s.length === 1 ? `Speaker ${s}` : s);
const DAY = 86400000;
const daysUntil = d => Math.round((new Date(d) - new Date(today())) / DAY);
const fmt = d =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const key = s => (s || '').trim().toLowerCase();
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning.' : h < 17 ? 'Good afternoon.' : 'Good evening.';
};

function dueText(d) {
  if (!d) return 'No date';
  const n = daysUntil(d);
  if (n < 0) return `${-n}d overdue`;
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return fmt(d);
}
function dueClass(t) {
  if (!t.deadline || t.status === 'done') return '';
  const n = daysUntil(t.deadline);
  return n < 0 ? 'overdue' : n <= 2 ? 'soon' : '';
}

async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || d.error || 'Request failed');
  return d;
}

function parsePasted(text) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const m = l.match(/^([A-Za-z][\w .]{0,30}):\s*(.+)$/);
      return m ? { speaker: m[1].trim(), text: m[2] } : { speaker: 'Unknown', text: l };
    });
}

function calendarLink(t) {
  const start = t.deadline.replaceAll('-', '');
  const next = new Date(t.deadline + 'T00:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  const end = next.toISOString().slice(0, 10).replaceAll('-', '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Due: ${t.task}`,
    dates: `${start}/${end}`,
    details: `Owner: ${t.owner || 'Unassigned'}\nFrom: ${t.meetings?.title || 'meeting'}`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function readSeen() {
  try { return new Set(JSON.parse(localStorage.getItem('seen-notes') || '[]')); }
  catch { return new Set(); }
}
function writeSeen(set) {
  try { localStorage.setItem('seen-notes', JSON.stringify([...set])); } catch { /* ignore */ }
}

const NAV = [
  ['today', 'Today', 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z'],
  ['capture', 'Capture', 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3'],
  ['tasks', 'Tasks', 'M4 5h16v16H4zM8 12l3 3 5-6'],
  ['decisions', 'Decisions', 'M6 3v12M18 9v12M6 15a6 6 0 0 0 6-6h6M6 3a2 2 0 1 0 0 .01M18 21a2 2 0 1 0 0 .01'],
  ['people', 'People', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 3a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3'],
];

function Icon({ d, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const BELL = 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0';

/* ---------- app ---------- */
export default function App() {
  const [tab, setTab] = useState('today');
  const [tasks, setTasks] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [people, setPeople] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [toast, setToast] = useState('');
  const [bellOpen, setBellOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    const [t, d, p, m] = await Promise.all([
      supabase.from('action_items').select('*, meetings(title)')
        .order('deadline', { ascending: true, nullsFirst: false }),
      supabase.from('decisions')
        .select('id, text, made_by, status, superseded_by, created_at, meetings(title)')
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('people').select('*').order('name'),
      supabase.from('meetings').select('id, title, summary, source, created_at')
        .order('created_at', { ascending: false }).limit(8),
    ]);
    setTasks(t.data || []);
    setDecisions(d.data || []);
    setPeople(p.data || []);
    setMeetings(m.data || []);
  }

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function setStatus(t, status) {
    setTasks(ts => ts.map(x => (x.id === t.id ? { ...x, status } : x)));
    await supabase.from('action_items').update({ status }).eq('id', t.id);
  }

  // Decisions that replaced an older one in the last 7 days
  const changes = useMemo(() => {
    const byId = new Map(decisions.map(d => [d.id, d]));
    return decisions
      .filter(d => d.status === 'superseded' && d.superseded_by && byId.has(d.superseded_by))
      .map(d => ({ old: d, now: byId.get(d.superseded_by) }))
      .filter(c => Date.now() - new Date(c.now.created_at) < 7 * DAY);
  }, [decisions]);

  // In-app notifications, derived from tasks and decisions
  const notes = useMemo(() => {
    const out = [];
    tasks.filter(t => t.status !== 'done' && t.deadline).forEach(t => {
      const n = daysUntil(t.deadline);
      if (n < 0) out.push({ id: `o-${t.id}-${t.deadline}`, kind: 'overdue', go: 'tasks',
        text: `${t.task} is ${-n}d overdue`, sub: t.owner || 'Unassigned' });
      else if (n <= 1) out.push({ id: `d-${t.id}-${t.deadline}`, kind: 'soon', go: 'tasks',
        text: `${t.task} is due ${n === 0 ? 'today' : 'tomorrow'}`, sub: t.owner || 'Unassigned' });
    });
    changes.forEach(c => out.push({ id: `c-${c.now.id}`, kind: 'change', go: 'decisions',
      text: `Decision changed: ${c.now.text}`, sub: `Replaces "${c.old.text}"` }));
    return out;
  }, [tasks, changes]);
  const unread = notes.filter(n => !seen.has(n.id)).length;

  function markAllRead() {
    const next = new Set([...seen, ...notes.map(n => n.id)]);
    setSeen(next);
    writeSeen(next);
  }

  function go(t) {
    setTab(t);
    setBellOpen(false);
    window.scrollTo(0, 0);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="dot" />Minutes</div>
        <nav>
          {NAV.map(([k, l, d]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>
              <Icon d={d} />{l}
            </button>
          ))}
        </nav>
        <p className="side-note">Every decision remembered. Every task owned.</p>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="brand mobile-only"><span className="dot" />Minutes</div>
          <span className="mono date">{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          <div className="bell-wrap">
            <button className="icon-btn" aria-label="Notifications" onClick={() => setBellOpen(o => !o)}>
              <Icon d={BELL} />
              {unread > 0 && <span className="count">{unread}</span>}
            </button>
            {bellOpen && (
              <div className="bell-panel">
                <div className="bell-head">
                  <span className="mono">Notifications</span>
                  {notes.length > 0 && <button className="link" onClick={markAllRead}>Mark all read</button>}
                </div>
                {notes.length === 0 && <p className="empty">You're all caught up.</p>}
                {notes.map(n => (
                  <button key={n.id} className={`note ${n.kind} ${seen.has(n.id) ? 'read' : ''}`}
                    onClick={() => go(n.go)}>
                    <span>{n.text}</span>
                    <span className="sub">{n.sub}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        <main className="content">
          {tab === 'today' && (
            <Today tasks={tasks} changes={changes} meetings={meetings}
              onCapture={() => go('capture')} onGo={go} onDone={t => setStatus(t, 'done')} />
          )}
          {tab === 'capture' && (
            <Capture onSaved={msg => { loadAll(); flash(msg); go('today'); }} />
          )}
          {tab === 'tasks' && (
            <Tasks tasks={tasks} setStatus={setStatus} />
          )}
          {tab === 'decisions' && <Decisions decisions={decisions} />}
          {tab === 'people' && (
            <People people={people} tasks={tasks} reload={loadAll} flash={flash} />
          )}
        </main>
      </div>

      <nav className="tabbar">
        {NAV.map(([k, l, d]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>
            <Icon d={d} size={22} /><span>{l}</span>
          </button>
        ))}
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ---------- Today ---------- */
function Today({ tasks, changes, meetings, onCapture, onGo, onDone }) {
  const open = tasks.filter(t => t.status !== 'done');
  const overdue = open.filter(t => t.deadline && daysUntil(t.deadline) < 0);
  const week = open.filter(t => t.deadline && daysUntil(t.deadline) >= 0 && daysUntil(t.deadline) <= 7);
  const dueCount = overdue.length + week.length;

  return (
    <>
      <h1 className="hero">
        {greeting()}<br />
        <em>{dueCount === 0 ? 'Nothing due this week.' : `${dueCount} thing${dueCount > 1 ? 's' : ''} due this week.`}</em>
      </h1>

      <button className="capture-card" onClick={onCapture}>
        <span className="rec-dot" />
        <span>
          <b>Capture a meeting</b>
          <span className="sub">Record, upload, or paste a transcript</span>
        </span>
      </button>

      {changes.slice(0, 3).map(c => (
        <button key={c.now.id} className="alert" onClick={() => onGo('decisions')}>
          <span className="mono">Decision changed</span>
          <span>{c.now.text}</span>
          <span className="sub">was: <s>{c.old.text}</s></span>
        </button>
      ))}

      <div className="today-grid">
      <section className="block">
        <div className="block-head">
          <h2>Due soon</h2>
          <button className="link" onClick={() => onGo('tasks')}>All tasks</button>
        </div>
        {[...overdue, ...week].length === 0 && (
          <p className="empty">Nothing due in the next 7 days.</p>
        )}
        {[...overdue, ...week].slice(0, 6).map(t => (
          <TaskRow key={t.id} t={t} onToggle={() => onDone(t)} />
        ))}
      </section>

      <section className="block">
        <div className="block-head"><h2>Recent meetings</h2></div>
        {meetings.length === 0 && <p className="empty">Your captured meetings appear here.</p>}
        {meetings.slice(0, 4).map(m => (
          <div className="meeting" key={m.id}>
            <div className="meeting-top">
              <span>{m.title}</span>
              <span className="mono">{fmt(m.created_at.slice(0, 10))}</span>
            </div>
            {m.summary && <p className="sub">{m.summary}</p>}
          </div>
        ))}
      </section>
      </div>
    </>
  );
}

/* ---------- shared task row ---------- */
function TaskRow({ t, onToggle }) {
  const done = t.status === 'done';
  return (
    <div className={`task-row ${done ? 'done' : ''}`}>
      <button className={`check ${done ? 'on' : ''}`} onClick={onToggle}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}>
        {done && <Icon d="M5 12l5 5 9-10" size={14} />}
      </button>
      <div className="task-body">
        <span className="task-name">{t.task}</span>
        <span className="task-meta">
          {t.owner || 'Unassigned'}
          {t.meetings?.title ? ` · ${t.meetings.title}` : ''}
          {t.trello_url && <> · <a href={t.trello_url} target="_blank" rel="noreferrer">Trello</a></>}
          {t.deadline && <> · <a href={calendarLink(t)} target="_blank" rel="noreferrer">Add to calendar</a></>}
        </span>
      </div>
      <span className={`badge ${dueClass(t)}`}>{done ? (t.deadline ? fmt(t.deadline) : 'Done') : dueText(t.deadline)}</span>
    </div>
  );
}

/* ---------- Tasks ---------- */
function Tasks({ tasks, setStatus }) {
  const [view, setView] = useState('list');
  const [who, setWho] = useState('all');
  const owners = [...new Set(tasks.map(t => t.owner).filter(Boolean))].sort();
  const list = who === 'all' ? tasks : tasks.filter(t => key(t.owner) === key(who));
  const toggle = t => setStatus(t, t.status === 'done' ? 'todo' : 'done');

  return (
    <>
      <div className="page-head">
        <h1>Tasks</h1>
        <div className="seg">
          {['list', 'board', 'calendar'].map(v => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="chips">
        {['all', ...owners].map(o => (
          <button key={o} className={`chip ${who === o ? 'on' : ''}`} onClick={() => setWho(o)}>
            {o === 'all' ? 'Everyone' : o}
          </button>
        ))}
      </div>

      {list.length === 0 && <p className="empty">No tasks yet. Capture a meeting to create some.</p>}

      {view === 'list' && list.length > 0 && <TaskList tasks={list} toggle={toggle} />}
      {view === 'board' && list.length > 0 && <Board tasks={list} setStatus={setStatus} />}
      {view === 'calendar' && <Calendar tasks={list} toggle={toggle} />}
    </>
  );
}

function TaskList({ tasks, toggle }) {
  const open = tasks.filter(t => t.status !== 'done');
  const groups = [
    ['Overdue', open.filter(t => t.deadline && daysUntil(t.deadline) < 0)],
    ['This week', open.filter(t => t.deadline && daysUntil(t.deadline) >= 0 && daysUntil(t.deadline) <= 7)],
    ['Later', open.filter(t => t.deadline && daysUntil(t.deadline) > 7)],
    ['No date', open.filter(t => !t.deadline)],
    ['Done', tasks.filter(t => t.status === 'done')],
  ];
  return groups.filter(([, g]) => g.length).map(([name, g]) => (
    <section className="block" key={name}>
      <p className={`mono group ${name === 'Overdue' ? 'danger' : ''}`}>{name} · {g.length}</p>
      {g.map(t => <TaskRow key={t.id} t={t} onToggle={() => toggle(t)} />)}
    </section>
  ));
}

function Board({ tasks, setStatus }) {
  const cols = { todo: 'To do', doing: 'In progress', done: 'Done' };
  const next = { todo: 'doing', doing: 'done', done: 'todo' };
  return (
    <div className="board">
      {Object.entries(cols).map(([k, l]) => {
        const list = tasks.filter(t => t.status === k);
        return (
          <div className="col" key={k}>
            <p className="mono">{l} · {list.length}</p>
            {list.map(t => (
              <button className="card" key={t.id} onClick={() => setStatus(t, next[t.status])}
                title="Move to the next column">
                <span>{t.task}</span>
                <span className="card-meta">
                  <span className="mono">{t.owner || 'Unassigned'}</span>
                  {t.deadline && <span className={`badge ${dueClass(t)}`}>{t.status === 'done' ? fmt(t.deadline) : dueText(t.deadline)}</span>}
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Calendar({ tasks, toggle }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [picked, setPicked] = useState(today());
  const byDay = useMemo(() => {
    const m = {};
    tasks.filter(t => t.deadline).forEach(t => { (m[t.deadline] ||= []).push(t); });
    return m;
  }, [tasks]);

  const y = month.getFullYear(), mo = month.getMonth();
  const offset = (new Date(y, mo, 1).getDay() + 6) % 7; // Monday first
  const days = new Date(y, mo + 1, 0).getDate();
  const cells = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const iso = d => `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dayTasks = byDay[picked] || [];

  return (
    <>
      <div className="cal-head">
        <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(new Date(y, mo - 1, 1))}>
          <Icon d="M15 6l-6 6 6 6" />
        </button>
        <h2>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
        <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(new Date(y, mo + 1, 1))}>
          <Icon d="M9 6l6 6-6 6" />
        </button>
      </div>
      <div className="cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="mono dow">{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const id = iso(d);
          const list = byDay[id] || [];
          const late = list.some(t => t.status !== 'done' && daysUntil(id) < 0);
          return (
            <button key={i}
              className={`day ${id === today() ? 'is-today' : ''} ${id === picked ? 'picked' : ''}`}
              onClick={() => setPicked(id)}>
              <span>{d}</span>
              {list.length > 0 && <span className={`pip ${late ? 'late' : ''}`}>{list.length}</span>}
            </button>
          );
        })}
      </div>
      <section className="block">
        <p className="mono group">{fmt(picked)} · {dayTasks.length} due</p>
        {dayTasks.length === 0 && <p className="empty">Nothing due this day.</p>}
        {dayTasks.map(t => <TaskRow key={t.id} t={t} onToggle={() => toggle(t)} />)}
      </section>
    </>
  );
}

/* ---------- Decisions ---------- */
function Decisions({ decisions }) {
  const byId = new Map(decisions.map(d => [d.id, d]));
  const active = decisions.filter(d => d.status !== 'superseded');
  const replaced = decisions.filter(d => d.status === 'superseded');
  return (
    <>
      <div className="page-head"><h1>Decisions</h1></div>
      <p className="lede">What the team has agreed, across every meeting. When a new meeting contradicts an old decision, it shows up here.</p>
      <section className="block">
        <p className="mono group">Active · {active.length}</p>
        {active.length === 0 && <p className="empty">No decisions yet.</p>}
        {active.map(d => {
          const prev = replaced.find(r => r.superseded_by === d.id);
          return (
            <div className="decision" key={d.id}>
              <span>{d.text}</span>
              {prev && <span className="was">replaced <s>{prev.text}</s></span>}
              <span className="sub">{d.made_by || 'Unknown'} · {d.meetings?.title} · {fmt(d.created_at.slice(0, 10))}</span>
            </div>
          );
        })}
      </section>
      {replaced.length > 0 && (
        <section className="block">
          <p className="mono group">Replaced · {replaced.length}</p>
          {replaced.map(d => (
            <div className="decision old" key={d.id}>
              <s>{d.text}</s>
              <span className="sub">
                {d.meetings?.title}
                {byId.get(d.superseded_by) ? ` → ${byId.get(d.superseded_by).text}` : ''}
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

/* ---------- People ---------- */
function People({ people, tasks, reload, flash }) {
  const [form, setForm] = useState({ name: '', email: '' });
  const [err, setErr] = useState('');
  const [sending, setSending] = useState('');
  const [openId, setOpenId] = useState(null);
  const known = new Set(people.map(p => key(p.name)));
  const missing = [...new Set(tasks.filter(t => t.owner && !known.has(key(t.owner))).map(t => t.owner))];

  async function add(name = form.name, email = form.email) {
    name = name.trim(); email = email.trim();
    if (!name || !email.includes('@')) return setErr('Enter a name and a valid email.');
    const { error } = await supabase.from('people').insert({ name, email });
    if (error) return setErr(error.message);
    setForm({ name: '', email: '' }); setErr('');
    reload();
  }
  async function remove(id) {
    await supabase.from('people').delete().eq('id', id);
    reload();
  }
  async function send(mode) {
    setSending(mode);
    try {
      const r = await post('/api/notify', { mode });
      flash(r.sent.length ? `Emailed ${r.sent.join(', ')}` : 'Nobody needed an email right now');
    } catch (e) { flash(e.message); }
    setSending('');
  }

  return (
    <>
      <div className="page-head"><h1>People</h1></div>
      <p className="lede">Task owners are matched to these names. Reminders go out daily at 8 am, digests every Monday.</p>

      <div className="actions">
        <button className="btn" disabled={!!sending} onClick={() => send('reminders')}>
          {sending === 'reminders' ? 'Sending…' : 'Send reminders now'}
        </button>
        <button className="btn ghost" disabled={!!sending} onClick={() => send('digest')}>
          {sending === 'digest' ? 'Sending…' : 'Send weekly digest'}
        </button>
      </div>

      <section className="block">
        {people.length === 0 && <p className="empty">Add your teammates so reminders reach them.</p>}
        {people.map(p => {
          const mine = tasks.filter(t => key(t.owner) === key(p.name) && t.status !== 'done');
          const late = mine.filter(t => t.deadline && daysUntil(t.deadline) < 0).length;
          const isOpen = openId === p.id;
          return (
            <div className="person" key={p.id}>
              <button className="person-top" onClick={() => setOpenId(isOpen ? null : p.id)}>
                <span className="avatar">{p.name.slice(0, 2).toUpperCase()}</span>
                <span className="person-name">
                  {p.name}
                  <span className="sub">{p.email}</span>
                </span>
                <span className="mono counts">
                  {mine.length} open{late ? <b className="late"> · {late} late</b> : ''}
                </span>
              </button>
              {isOpen && (
                <div className="person-body">
                  {mine.length === 0 && <p className="empty">No open tasks.</p>}
                  {mine.map(t => (
                    <div className="mini" key={t.id}>
                      <span>{t.task}</span>
                      <span className={`badge ${dueClass(t)}`}>{dueText(t.deadline)}</span>
                    </div>
                  ))}
                  <button className="link" onClick={() => remove(p.id)}>Remove {p.name}</button>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {missing.length > 0 && (
        <p className="hint">No email yet for: {missing.map((m, i) => (
          <button key={m} className="link" onClick={() => setForm({ name: m, email: '' })}>
            {m}{i < missing.length - 1 ? ',' : ''}
          </button>
        ))}</p>
      )}

      <section className="block">
        <p className="mono group">Add a person</p>
        <div className="add-row">
          <input type="text" placeholder="Name, as said in meetings" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input type="email" placeholder="name@company.com" value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <button className="btn ghost" onClick={() => add()}>Add</button>
        </div>
        {err && <p className="error">{err}</p>}
      </section>
    </>
  );
}

/* ---------- Capture ---------- */
function Capture({ onSaved }) {
  const [mode, setMode] = useState('record');
  const [title, setTitle] = useState('');
  const [stage, setStage] = useState('input'); // input | working | speakers | review
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [source, setSource] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [utterances, setUtterances] = useState([]);
  const [speakerMap, setSpeakerMap] = useState({});
  const [result, setResult] = useState(null);
  const [pasted, setPasted] = useState('');

  function reset() {
    setStage('input'); setTitle(''); setSource(null); setAudioUrl(null); setError('');
    setUtterances([]); setSpeakerMap({}); setResult(null); setPasted(''); setStatus('');
  }
  function fail(e, back = 'input') { setError(e.message || String(e)); setStage(back); }

  function toSpeakers(utts, src) {
    setUtterances(utts); setSource(src);
    const map = {};
    utts.forEach(u => { if (!(u.speaker in map)) map[u.speaker] = u.speaker.length === 1 ? '' : u.speaker; });
    setSpeakerMap(map);
    setStage('speakers');
  }

  async function handleAudio(blob, src) {
    setError(''); setStage('working');
    try {
      if (!blob.size) throw new Error('The recording came out empty. Try again and record for a few seconds.');
      setStatus('Uploading audio');
      const ext = blob.name ? blob.name.split('.').pop() : (blob.type.split('/')[1] || 'webm').split(';')[0];
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('recordings')
        .upload(path, blob, { contentType: blob.type || 'audio/webm' });
      if (upErr) throw upErr;
      const url = supabase.storage.from('recordings').getPublicUrl(path).data.publicUrl;
      setAudioUrl(url);

      setStatus('Transcribing and separating speakers');
      const { id } = await post('/api/transcribe', { audioUrl: url });
      let res;
      do {
        await new Promise(r => setTimeout(r, 3000));
        const r = await fetch(`/api/transcript-status?id=${id}`);
        res = await r.json();
        if (!r.ok) throw new Error(res.error || 'Transcription failed');
      } while (res.status !== 'completed');
      if (!res.utterances.length) throw new Error('No speech detected in this recording.');
      toSpeakers(res.utterances, src);
    } catch (e) { fail(e); }
  }

  function handlePaste() {
    setError('');
    const utts = parsePasted(pasted);
    if (!utts.length) return setError('Paste or dictate some meeting text first.');
    toSpeakers(utts, 'text');
  }

  const named = () => utterances.map(u => ({
    speaker: speakerMap[u.speaker]?.trim() || label(u.speaker), text: u.text,
  }));

  async function extract() {
    setError(''); setStage('working');
    setStatus('Pulling out decisions, owners and deadlines');
    try {
      const data = await post('/api/extract', { transcript: named(), meetingDate: today() });
      const decisions = (data.decisions || []).map(d => ({ ...d, keep: true }));
      setStatus('Checking against past decisions');
      const { data: past } = await supabase.from('decisions')
        .select('id, text, made_by, created_at, meetings(title)')
        .eq('status', 'active').order('created_at', { ascending: false }).limit(60);
      if (decisions.length && past?.length) {
        const { conflicts } = await post('/api/conflicts', { newDecisions: decisions, pastDecisions: past });
        conflicts.forEach(c => {
          decisions[c.new_index].conflict = { ...c, old: past.find(p => p.id === c.past_id) };
          decisions[c.new_index].supersede = true;
        });
      }
      setResult({
        summary: data.summary || '',
        decisions,
        actions: (data.action_items || []).map(a => ({ ...a, keep: true })),
      });
      setStage('review');
    } catch (e) { fail(e, 'speakers'); }
  }

  function edit(kind, i, field, value) {
    setResult(r => ({ ...r, [kind]: r[kind].map((x, j) => (j === i ? { ...x, [field]: value } : x)) }));
  }

  async function confirm() {
    setError(''); setStage('working'); setStatus('Saving');
    try {
      const { data: m, error: mErr } = await supabase.from('meetings').insert({
        title: title.trim() || `Meeting · ${fmt(today())}`,
        source, audio_url: audioUrl, transcript: named(), speaker_map: speakerMap,
        summary: result.summary, status: 'confirmed',
      }).select().single();
      if (mErr) throw mErr;

      const kept = result.decisions.filter(d => d.keep && d.text?.trim());
      if (kept.length) {
        const { data: saved, error: e } = await supabase.from('decisions')
          .insert(kept.map(d => ({ meeting_id: m.id, text: d.text, made_by: d.made_by || null, confirmed: true })))
          .select('id');
        if (e) throw e;
        for (let i = 0; i < kept.length; i++) {
          if (kept[i].conflict && kept[i].supersede) {
            await supabase.from('decisions')
              .update({ status: 'superseded', superseded_by: saved[i].id })
              .eq('id', kept[i].conflict.past_id);
          }
        }
      }

      const actions = result.actions.filter(a => a.keep && a.task?.trim()).map(a => ({
        meeting_id: m.id, task: a.task, owner: a.owner || null, deadline: a.deadline || null, confirmed: true,
      }));
      let msg = `Saved ${kept.length} decision${kept.length === 1 ? '' : 's'} and ${actions.length} task${actions.length === 1 ? '' : 's'}`;
      if (actions.length) {
        const { data: savedActions, error: e } = await supabase.from('action_items')
          .insert(actions).select('id, task, owner, deadline');
        if (e) throw e;
        setStatus('Syncing to Trello');
        try {
          const { cards } = await post('/api/trello', { items: savedActions, meetingTitle: m.title });
          await Promise.all(cards.filter(c => c.url)
            .map(c => supabase.from('action_items').update({ trello_url: c.url }).eq('id', c.id)));
        } catch { msg += ' (Trello sync skipped)'; }
      }
      reset();
      onSaved(msg);
    } catch (e) { fail(e, 'review'); }
  }

  const steps = ['Capture', 'Speakers', 'Review'];
  const stepIdx = stage === 'review' ? 2 : stage === 'speakers' ? 1 : 0;

  return (
    <>
      <div className="page-head"><h1>Capture</h1></div>
      <ol className="steps">
        {steps.map((s, i) => <li key={s} className={i <= stepIdx ? 'on' : ''}>{s}</li>)}
      </ol>

      <section className="panel">
        {stage === 'input' && (
          <>
            <input type="text" className="title-input" placeholder="Meeting title, like Sprint sync"
              value={title} onChange={e => setTitle(e.target.value)} />
            <div className="seg wide">
              {[['record', 'Record'], ['upload', 'Upload'], ['paste', 'Paste']].map(([k, l]) => (
                <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>
              ))}
            </div>
            {mode === 'record' && <Recorder onDone={b => handleAudio(b, 'record')} />}
            {mode === 'upload' && (
              <label className="drop">
                <input type="file" accept="audio/*" hidden
                  onChange={e => e.target.files[0] && handleAudio(e.target.files[0], 'upload')} />
                <Icon d="M12 16V4M7 9l5-5 5 5M4 20h16" size={24} />
                <span>Choose a recording</span>
                <span className="sub">Voice memos, call recordings, any audio file</span>
              </label>
            )}
            {mode === 'paste' && (
              <>
                <textarea value={pasted} onChange={e => setPasted(e.target.value)}
                  placeholder={'Riya: We launch the beta on 10 November.\nAman: I\'ll finish onboarding by Wednesday.'} />
                <p className="hint">Start lines with a name to tag who spoke. Wispr Flow works great here.</p>
                <div className="row end"><button className="btn" onClick={handlePaste}>Continue</button></div>
              </>
            )}
          </>
        )}

        {stage === 'working' && (
          <div className="working"><div className="spinner" /><span>{status}…</span></div>
        )}

        {stage === 'speakers' && (
          <>
            <h2>Who said what?</h2>
            <p className="hint">Name each voice so owners come out right.</p>
            {Object.keys(speakerMap).map(k => (
              <div className="speaker" key={k}>
                <span className="badge">{label(k)}</span>
                <input type="text" placeholder="Name" value={speakerMap[k]}
                  onChange={e => setSpeakerMap(m => ({ ...m, [k]: e.target.value }))} />
              </div>
            ))}
            <div className="transcript">
              {utterances.map((u, i) => (
                <p key={i}><b>{speakerMap[u.speaker] || label(u.speaker)}</b> {u.text}</p>
              ))}
            </div>
            <div className="row end">
              <button className="btn ghost" onClick={reset}>Start over</button>
              <button className="btn" onClick={extract}>Extract</button>
            </div>
          </>
        )}

        {stage === 'review' && result && (
          <>
            <h2>Review before saving</h2>
            <p className="summary">{result.summary}</p>

            <p className="mono group">Decisions</p>
            {result.decisions.length === 0 && <p className="empty">None found.</p>}
            {result.decisions.map((d, i) => (
              <div key={i}>
                <div className={`edit-row decision-row ${d.keep ? '' : 'off'}`}>
                  <input type="checkbox" checked={d.keep} onChange={e => edit('decisions', i, 'keep', e.target.checked)} />
                  <input type="text" value={d.text} onChange={e => edit('decisions', i, 'text', e.target.value)} />
                  <input type="text" placeholder="Made by" value={d.made_by || ''}
                    onChange={e => edit('decisions', i, 'made_by', e.target.value)} />
                </div>
                {d.conflict && d.keep && (
                  <div className="conflict">
                    <span className="mono">Conflicts with an earlier decision</span>
                    <p><s>{d.conflict.old?.text}</s> · {d.conflict.old?.made_by || 'unknown'}
                      {d.conflict.old?.meetings?.title ? `, ${d.conflict.old.meetings.title}` : ''}</p>
                    <p className="sub">{d.conflict.explanation}</p>
                    <div className="row">
                      <button className={`chip ${d.supersede ? 'on' : ''}`}
                        onClick={() => edit('decisions', i, 'supersede', true)}>Replace old decision</button>
                      <button className={`chip ${!d.supersede ? 'on' : ''}`}
                        onClick={() => edit('decisions', i, 'supersede', false)}>Keep both</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <p className="mono group">Action items</p>
            {result.actions.length === 0 && <p className="empty">None found.</p>}
            {result.actions.map((a, i) => (
              <div className={`edit-row ${a.keep ? '' : 'off'}`} key={i}>
                <input type="checkbox" checked={a.keep} onChange={e => edit('actions', i, 'keep', e.target.checked)} />
                <input type="text" value={a.task} onChange={e => edit('actions', i, 'task', e.target.value)} />
                <input type="text" placeholder="Owner" value={a.owner || ''}
                  onChange={e => edit('actions', i, 'owner', e.target.value)} />
                <input type="date" value={a.deadline || ''} onChange={e => edit('actions', i, 'deadline', e.target.value)} />
              </div>
            ))}

            <p className="hint">Nothing is saved, synced, or sent until you confirm.</p>
            <div className="row end">
              <button className="btn ghost" onClick={reset}>Discard</button>
              <button className="btn" onClick={confirm}>Confirm and save</button>
            </div>
          </>
        )}

        {error && stage !== 'working' && <p className="error">{error}</p>}
      </section>
    </>
  );
}

function Recorder({ onDone }) {
  const [live, setLive] = useState(false);
  const [secs, setSecs] = useState(0);
  const mr = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const m = new MediaRecorder(stream);
      chunks.current = [];
      m.ondataavailable = e => e.data.size && chunks.current.push(e.data);
      m.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        onDone(new Blob(chunks.current, { type: m.mimeType || 'audio/webm' }));
      };
      m.start(1000); // 1-second chunks, needed for iPhone Safari
      mr.current = m;
      setSecs(0); setLive(true);
      timer.current = setInterval(() => setSecs(s => s + 1), 1000);
    } catch {
      alert('Microphone access was blocked. Allow it in your browser settings.');
    }
  }
  function stop() { clearInterval(timer.current); setLive(false); mr.current?.stop(); }

  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return (
    <div className="rec">
      <button className={`rec-btn ${live ? 'live' : ''}`} onClick={live ? stop : start}
        aria-label={live ? 'Stop recording' : 'Start recording'}>
        {live && <span className="stop-square" />}
      </button>
      <span className="timer">{mm}:{ss}</span>
      <span className="mono">{live ? 'Recording · tap to stop' : 'Tap to record'}</span>
    </div>
  );
}