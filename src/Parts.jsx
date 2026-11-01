// Pieces shared by several screens.
import { useStore } from './lib/store';
import { fmtTime, dayLabel, daysFrom, clock, duration } from './lib/util';
import { Icon, I } from './Icons';

export function ItemRow({ it, onOpen, showDate = true }) {
  const { setItemStatus, catById } = useStore();
  const cat = catById(it.category_id);
  const done = it.status === 'done';
  const late = !done && it.due_date && daysFrom(it.due_date) < 0;
  const when = [showDate && it.due_date ? dayLabel(it.due_date) : null, it.due_time ? fmtTime(it.due_time) : null].filter(Boolean).join(' · ');
  return (
    <div className={`irow ${done ? 'done' : ''} ${it.kind}`}>
      {it.kind === 'event' && !done
        ? <span className="ev-bar" style={{ background: cat?.color || 'var(--ink)' }} />
        : (
          <button className={`check ${done ? 'on' : ''}`} onClick={() => setItemStatus(it, done ? 'open' : 'done')}
            aria-label={done ? 'Mark as not done' : 'Mark as done'}>
            {done && <Icon d={I.check} size={13} stroke={2.4} />}
          </button>
        )}
      <button className="irow-body" onClick={() => onOpen(it)}>
        <span className="irow-title">{it.title}</span>
        <span className="irow-meta">
          {cat && <span className="cdot" style={{ background: cat.color }} />}
          {cat?.name}
          {it.owner && <span className="tag">waiting on {it.owner}</span>}
          {it.kind === 'event' && it.due_time && it.end_time ? <span>until {fmtTime(it.end_time)}</span> : null}
        </span>
      </button>
      {when && <span className={`when ${late ? 'late' : ''}`}>{late ? `${dayLabel(it.due_date)}${it.due_time ? ' · ' + fmtTime(it.due_time) : ''}` : when}</span>}
    </div>
  );
}

export function EntryCard({ e, onOpen }) {
  const { catById, items } = useStore();
  const cat = catById(e.category_id);
  const working = e.status === 'processing' || e.status === 'finalizing';
  const sug = items.filter(i => i.entry_id === e.id && i.status === 'suggested').length;
  const tasks = items.filter(i => i.entry_id === e.id && i.status !== 'suggested').length;
  const label = { meeting: 'Meeting', conversation: 'Conversation', note: 'Note' }[e.kind];
  return (
    <button className={`ecard ${working ? 'working' : ''} ${e.status === 'failed' ? 'failed' : ''}`} onClick={() => onOpen(e)}>
      <span className="ecard-top">
        <span className="ecard-title"><span className="cdot" style={{ background: cat?.color || 'var(--line)' }} />{e.title || label}</span>
        <span className="mono">{clock(e.started_at)}</span>
      </span>
      {working && <span className="sub"><span className="spinner tiny" /> Writing your minutes…</span>}
      {e.status === 'failed' && <span className="sub err">Couldn’t finish. Tap to retry.</span>}
      {e.status === 'ready' && (e.summary || e.note_text) && <span className="ecard-sum">{e.summary || e.note_text}</span>}
      <span className="ecard-meta">
        {label}{e.duration_sec ? ` · ${duration(e.duration_sec)}` : ''}{cat ? ` · ${cat.name}` : ''}
        {tasks ? ` · ${tasks} item${tasks > 1 ? 's' : ''}` : ''}
        {sug ? <b className="pill">{sug} to review</b> : null}
      </span>
    </button>
  );
}

export function CatFilter({ value, onChange }) {
  const { categories } = useStore();
  return (
    <div className="chips">
      <button className={`chip ${!value ? 'on' : ''}`} onClick={() => onChange(null)}>All</button>
      {categories.map(c => (
        <button key={c.id} className={`chip ${value === c.id ? 'on' : ''}`} onClick={() => onChange(value === c.id ? null : c.id)}>
          <span className="cdot" style={{ background: c.color }} />{c.name}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children }) {
  return <div className="empty-box"><b>{title}</b>{children && <span>{children}</span>}</div>;
}
