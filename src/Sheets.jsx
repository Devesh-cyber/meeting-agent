// Bottom sheets: capture menu, record, note to self, upload, and the task/event editor.
import { useEffect, useRef, useState } from 'react';
import { useStore } from './lib/store';
import { post, uploadAudio, today, addDays, fmtTime, dayLabel } from './lib/util';
import { Icon, I } from './Icons';

export function Sheet({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    document.body.classList.add('sheet-open');
    return () => { document.removeEventListener('keydown', k); document.body.classList.remove('sheet-open'); };
  }, [onClose]);
  return (
    <div className="sheet-back" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon d={I.x} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CategoryPicker({ value, onChange, allowNone = true }) {
  const { categories } = useStore();
  return (
    <div className="chips wrap">
      {allowNone && <button type="button" className={`chip ${!value ? 'on' : ''}`} onClick={() => onChange(null)}>Auto</button>}
      {categories.map(c => (
        <button type="button" key={c.id} className={`chip ${value === c.id ? 'on' : ''}`} onClick={() => onChange(c.id)}>
          <span className="cdot" style={{ background: c.color }} />{c.name}
        </button>
      ))}
    </div>
  );
}

/* ---------- the + menu ---------- */
export function CaptureMenu({ onPick, onClose }) {
  const opts = [
    ['record', 'Record', 'A meeting or a conversation', I.mic, true],
    ['note', 'Note to self', 'Say or type it, it becomes tasks and reminders', I.note],
    ['upload', 'Upload a recording', 'Voice memos, call recordings', I.upload],
    ['item', 'Add a task or event', 'Straight onto your calendar', I.plus],
  ];
  return (
    <Sheet title="Capture" onClose={onClose}>
      <div className="menu-list">
        {opts.map(([k, l, s, d, hot]) => (
          <button key={k} className={`menu-row ${hot ? 'hot' : ''}`} onClick={() => onPick(k)}>
            <span className="menu-ico"><Icon d={d} /></span>
            <span><b>{l}</b><span className="sub">{s}</span></span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ---------- recorder (shared by Record and voice notes) ---------- */
function useRecorder() {
  const [state, setState] = useState('idle'); // idle | live | stopped
  const [secs, setSecs] = useState(0);
  const mr = useRef(null), chunks = useRef([]), timer = useRef(null), stream = useRef(null), lock = useRef(null), resolve = useRef(null);

  useEffect(() => () => {
    clearInterval(timer.current);
    if (mr.current) mr.current.onstop = null;
    try { if (mr.current?.state === 'recording') mr.current.stop(); } catch { /* ignore */ }
    stream.current?.getTracks().forEach(t => t.stop());
    lock.current?.release?.().catch(() => {});
  }, []);

  async function start() {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    stream.current = s;
    const m = new MediaRecorder(s);
    chunks.current = [];
    m.ondataavailable = e => e.data.size && chunks.current.push(e.data);
    m.onstop = () => {
      s.getTracks().forEach(t => t.stop());
      lock.current?.release?.().catch(() => {});
      resolve.current?.(new Blob(chunks.current, { type: m.mimeType || 'audio/webm' }));
    };
    m.start(1000);
    mr.current = m;
    // Keep the screen awake: phones stop browser recordings when the screen locks
    try { lock.current = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
    setSecs(0); setState('live');
    timer.current = setInterval(() => setSecs(x => x + 1), 1000);
  }
  function stop() {
    clearInterval(timer.current);
    setState('stopped');
    return new Promise(r => { resolve.current = r; mr.current?.stop(); });
  }
  const mm = String(Math.floor(secs / 60)).padStart(2, '0'), ss = String(secs % 60).padStart(2, '0');
  return { state, secs, time: `${mm}:${ss}`, start, stop };
}

/* ---------- record a meeting or conversation ---------- */
export function RecordSheet({ onClose }) {
  const { user, createRecording, flash } = useStore();
  const rec = useRecorder();
  const [kind, setKind] = useState('conversation');
  const [cat, setCat] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const started = useRef(null);
  const autoStarted = useRef(false);

  async function begin() {
    setErr('');
    try { started.current = new Date().toISOString(); await rec.start(); }
    catch { setErr('Microphone access was blocked. Allow it in your browser settings.'); }
  }
  // Opened from the "Record" shortcut: start straight away
  useEffect(() => {
    if (!autoStarted.current && new URLSearchParams(window.location.search).get('go') === 'record') {
      autoStarted.current = true;
      window.history.replaceState(null, '', window.location.pathname);
      begin();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function finish() {
    const secs = rec.secs;
    const blob = await rec.stop();
    setBusy('Saving');
    try {
      const path = await uploadAudio(user.id, blob);
      await createRecording({ kind, path, duration: secs, category_id: cat, startedAt: started.current });
      flash('Saved. Your minutes will be ready in a minute or two.');
      onClose();
    } catch (e) { setErr(e.message); setBusy(''); }
  }

  const live = rec.state === 'live';
  return (
    <Sheet title={live ? 'Recording' : 'Record'} onClose={() => (live ? window.confirm('Stop and discard this recording?') && onClose() : onClose())}>
      {!live && !busy && (
        <>
          <div className="seg wide">
            <button className={kind === 'conversation' ? 'on' : ''} onClick={() => setKind('conversation')}>Conversation</button>
            <button className={kind === 'meeting' ? 'on' : ''} onClick={() => setKind('meeting')}>Meeting</button>
          </div>
          <CategoryPicker value={cat} onChange={setCat} />
        </>
      )}
      <div className="rec">
        <button className={`rec-btn ${live ? 'live' : ''}`} disabled={!!busy} onClick={live ? finish : begin}
          aria-label={live ? 'Stop recording' : 'Start recording'}>
          {live && <span className="stop-square" />}
        </button>
        <span className="timer">{rec.time}</span>
        <span className="mono">{busy ? `${busy}…` : live ? 'Tap to stop · keep this screen open' : 'Tap to start'}</span>
      </div>
      {!busy && <p className="hint center">Let people know you’re taking notes. It keeps conversations comfortable.</p>}
      {err && <p className="error">{err}</p>}
    </Sheet>
  );
}

/* ---------- upload an existing recording ---------- */
export function UploadSheet({ onClose }) {
  const { user, createRecording, flash } = useStore();
  const [kind, setKind] = useState('conversation');
  const [cat, setCat] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function pick(file) {
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) return setErr('That file is over 100 MB. Trim it or upload a shorter one.');
    setBusy(true); setErr('');
    try {
      const path = await uploadAudio(user.id, file);
      const when = file.lastModified ? new Date(file.lastModified).toISOString() : undefined;
      await createRecording({ kind, path, category_id: cat, startedAt: when });
      flash('Uploaded. Your minutes will be ready in a minute or two.');
      onClose();
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <Sheet title="Upload a recording" onClose={onClose}>
      <div className="seg wide">
        <button className={kind === 'conversation' ? 'on' : ''} onClick={() => setKind('conversation')}>Conversation</button>
        <button className={kind === 'meeting' ? 'on' : ''} onClick={() => setKind('meeting')}>Meeting</button>
      </div>
      <CategoryPicker value={cat} onChange={setCat} />
      <label className={`drop ${busy ? 'busy' : ''}`}>
        <input type="file" accept="audio/*,video/mp4,video/webm" hidden disabled={busy} onChange={e => pick(e.target.files[0])} />
        <Icon d={I.upload} size={26} />
        <span>{busy ? 'Uploading…' : 'Choose a recording'}</span>
        <span className="sub">On iPhone, Voice Memos → Share → Save to Files, then pick it here.</span>
      </label>
      {err && <p className="error">{err}</p>}
    </Sheet>
  );
}

/* ---------- note to self ---------- */
export function NoteSheet({ onClose, onOpenItem }) {
  const { user, load, deleteItems, deleteEntry, flash, catById } = useStore();
  const rec = useRecorder();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const box = useRef(null);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('go') === 'note') window.history.replaceState(null, '', window.location.pathname); box.current?.focus(); }, []);

  async function send(body) {
    setBusy('Working it out'); setErr('');
    try {
      const r = await post('/api/note', body);
      setResult(r); setText('');
      await load();
    } catch (e) { setErr(e.message); }
    setBusy('');
  }
  async function voice() {
    if (rec.state === 'live') {
      const blob = await rec.stop();
      setBusy('Listening');
      try { send({ audioPath: await uploadAudio(user.id, blob) }); }
      catch (e) { setErr(e.message); setBusy(''); }
      return;
    }
    try { await rec.start(); } catch { setErr('Microphone access was blocked. Allow it in your browser settings.'); }
  }
  async function undo() {
    if (result.items.length) await deleteItems(result.items.map(i => i.id));
    await deleteEntry({ id: result.entry.id });
    setResult(null); flash('Undone');
  }

  if (result) {
    return (
      <Sheet title="Got it" onClose={onClose}>
        {result.items.length === 0
          ? <p className="hint">Saved as a note. There was nothing to schedule in it.</p>
          : <p className="hint">Added {result.items.length} item{result.items.length > 1 ? 's' : ''}:</p>}
        {result.items.map(it => (
          <button key={it.id} className="added" onClick={() => onOpenItem(it)}>
            <span className="cdot" style={{ background: catById(it.category_id)?.color || 'var(--line)' }} />
            <span className="added-title">{it.title}</span>
            <span className="badge">{it.due_date ? `${dayLabel(it.due_date)}${it.due_time ? ' · ' + fmtTime(it.due_time) : ''}` : 'Someday'}</span>
          </button>
        ))}
        <p className="quote">“{result.text}”</p>
        <div className="row end">
          <button className="btn ghost" onClick={undo}>Undo</button>
          <button className="btn ghost" onClick={() => setResult(null)}>Add another</button>
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title="Note to self" onClose={onClose}>
      <textarea ref={box} className="note-box" value={text} disabled={!!busy || rec.state === 'live'}
        placeholder={'Call Rahul tomorrow at 5 pm\nPay rent on the 5th\nDentist Friday 11 am'}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) send({ text }); }} />
      <p className="hint">Type it, dictate with Wispr Flow, or tap the mic and just say it.</p>
      <div className="row note-actions">
        <button className={`mic ${rec.state === 'live' ? 'live' : ''}`} onClick={voice} disabled={!!busy} aria-label={rec.state === 'live' ? 'Stop and add' : 'Speak your note'}>
          <Icon d={rec.state === 'live' ? I.stop : I.mic} />
          {rec.state === 'live' ? <span>{rec.time} · tap to finish</span> : <span>Speak</span>}
        </button>
        <button className="btn" disabled={!!busy || !text.trim()} onClick={() => send({ text })}>{busy ? `${busy}…` : 'Add'}</button>
      </div>
      {err && <p className="error">{err}</p>}
    </Sheet>
  );
}

/* ---------- add or edit a task / event ---------- */
const REMIND = [[null, 'Default'], [-1, 'None'], [0, 'At the time'], [10, '10 min before'], [30, '30 min before'], [60, '1 hour before'], [1440, '1 day before']];

export function ItemSheet({ item, onClose, onOpenEntry }) {
  const { saveItem, deleteItems, setItemStatus, flash, entries, profile } = useStore();
  const isNew = !item?.id;
  const [f, setF] = useState(() => {
    const base = { kind: 'task', title: '', category_id: null, notes: '', owner: '', remind_offset_min: null, ...item };
    base.due_date = item?.due_date || '';
    base.due_time = item?.due_time ? item.due_time.slice(0, 5) : '';
    base.end_time = item?.end_time ? item.end_time.slice(0, 5) : '';
    return base;
  });
  const [err, setErr] = useState('');
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const entry = item?.entry_id && entries.find(e => e.id === item.entry_id);

  async function save(e) {
    e?.preventDefault();
    try {
      await saveItem({ ...f, status: f.status === 'suggested' ? 'open' : f.status });
      flash(isNew ? 'Added' : 'Saved');
      onClose();
    } catch (x) { setErr(x.message); }
  }
  async function remove() {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    await deleteItems([item.id]); onClose();
  }
  const quick = [['Today', today()], ['Tomorrow', addDays(today(), 1)], ['Next week', addDays(today(), 7)], ['Someday', '']];
  const defLabel = f.due_time ? `${profile?.remind_minutes ?? 30} min before` : `${profile?.allday_hour ?? 9}:00 that day`;

  return (
    <Sheet title={isNew ? 'New' : f.status === 'suggested' ? 'Review suggestion' : f.kind === 'event' ? 'Event' : 'Task'} onClose={onClose}>
      <form onSubmit={save} className="form">
        <div className="seg wide">
          <button type="button" className={f.kind === 'task' ? 'on' : ''} onClick={() => set('kind', 'task')}>Task</button>
          <button type="button" className={f.kind === 'event' ? 'on' : ''} onClick={() => set('kind', 'event')}>Event</button>
        </div>
        <input type="text" className="big-input" placeholder={f.kind === 'event' ? 'Call with Rahul' : 'Send the deck to Priya'}
          value={f.title} autoFocus={isNew} onChange={e => set('title', e.target.value)} />
        <div className="chips wrap">
          {quick.map(([l, d]) => (
            <button type="button" key={l} className={`chip ${f.due_date === d ? 'on' : ''}`} onClick={() => set('due_date', d)}>{l}</button>
          ))}
        </div>
        <div className="grid2">
          <label className="field"><span>Date</span><input type="date" value={f.due_date} onChange={e => set('due_date', e.target.value)} /></label>
          <label className="field"><span>Time</span><input type="time" value={f.due_time} disabled={!f.due_date} onChange={e => set('due_time', e.target.value)} /></label>
          {f.kind === 'event' && f.due_time && (
            <label className="field"><span>Ends</span><input type="time" value={f.end_time} onChange={e => set('end_time', e.target.value)} /></label>
          )}
          <label className="field"><span>Reminder</span>
            <select value={f.remind_offset_min ?? ''} disabled={!f.due_date}
              onChange={e => set('remind_offset_min', e.target.value === '' ? null : Number(e.target.value))}>
              {REMIND.filter(([v]) => f.due_time || v === null || v === -1).map(([v, l]) => (
                <option key={l} value={v ?? ''}>{v === null ? `Default (${defLabel})` : l}</option>
              ))}
            </select>
          </label>
        </div>
        <span className="field-label">Category</span>
        <CategoryPicker value={f.category_id} onChange={v => set('category_id', v)} allowNone={false} />
        <label className="field"><span>Waiting on someone? (optional)</span>
          <input type="text" placeholder="Their name" value={f.owner || ''} onChange={e => set('owner', e.target.value)} /></label>
        <label className="field"><span>Notes</span>
          <textarea rows={2} value={f.notes || ''} onChange={e => set('notes', e.target.value)} /></label>
        {entry && <button type="button" className="link from" onClick={() => onOpenEntry(entry)}>From: {entry.title || 'a conversation'}</button>}
        {err && <p className="error">{err}</p>}
        <div className="row end">
          {!isNew && <button type="button" className="link danger" onClick={remove}>Delete</button>}
          {!isNew && f.status !== 'suggested' && (
            <button type="button" className="btn ghost" onClick={() => { setItemStatus(item, item.status === 'done' ? 'open' : 'done'); onClose(); }}>
              {item.status === 'done' ? 'Not done' : 'Mark done'}
            </button>
          )}
          <button className="btn">{f.status === 'suggested' ? 'Add to my list' : isNew ? 'Add' : 'Save'}</button>
        </div>
      </form>
    </Sheet>
  );
}
