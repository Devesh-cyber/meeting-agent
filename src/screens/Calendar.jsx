import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { iso, today, addDays, dateOf, dayLabel, byWhen } from '../lib/util';
import { ItemRow, EntryCard, CatFilter, Empty } from '../Parts';
import { Icon, I } from '../Icons';

export default function Calendar({ open }) {
  const { items, entries, catById } = useStore();
  const [view, setView] = useState('month');
  const [picked, setPicked] = useState(today());
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [cat, setCat] = useState(null);

  const shown = items.filter(i => i.status !== 'suggested' && i.due_date && (!cat || i.category_id === cat));
  const byDay = useMemo(() => {
    const m = {};
    shown.forEach(i => { (m[i.due_date] ||= []).push(i); });
    Object.values(m).forEach(l => l.sort(byWhen));
    return m;
  }, [shown]);
  const entriesByDay = useMemo(() => {
    const m = {};
    entries.filter(e => !cat || e.category_id === cat).forEach(e => { (m[dateOf(e.started_at)] ||= []).push(e); });
    return m;
  }, [entries, cat]);

  const y = month.getFullYear(), mo = month.getMonth();
  const offset = (new Date(y, mo, 1).getDay() + 6) % 7;
  const days = new Date(y, mo + 1, 0).getDate();
  const cells = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => iso(new Date(y, mo, i + 1)))];
  const t = today();

  function jumpToday() { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setPicked(t); }

  // Agenda: the next 30 days with anything in them
  const agenda = Array.from({ length: 30 }, (_, n) => addDays(t, n))
    .filter(d => byDay[d]?.length || entriesByDay[d]?.length);

  const dayItems = byDay[picked] || [];
  const dayEntries = entriesByDay[picked] || [];

  return (
    <>
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="seg">
          <button className={view === 'month' ? 'on' : ''} onClick={() => setView('month')}>Month</button>
          <button className={view === 'agenda' ? 'on' : ''} onClick={() => setView('agenda')}>Agenda</button>
        </div>
      </div>
      <CatFilter value={cat} onChange={setCat} />

      {view === 'month' && (
        <div className="cal-wrap">
          <div className="cal-side">
            <div className="cal-head">
              <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(new Date(y, mo - 1, 1))}><Icon d={I.left} /></button>
              <h2>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
              <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(new Date(y, mo + 1, 1))}><Icon d={I.right} /></button>
              <button className="link" onClick={jumpToday}>Today</button>
            </div>
            <div className="cal">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="mono dow">{d}</span>)}
              {cells.map((d, i) => {
                if (!d) return <span key={i} />;
                const list = byDay[d] || [];
                const open_ = list.filter(x => x.status !== 'done');
                const late = d < t && open_.length > 0;
                return (
                  <button key={d} className={`day ${d === t ? 'is-today' : ''} ${d === picked ? 'picked' : ''}`} onClick={() => setPicked(d)}>
                    <span className="dnum">{Number(d.slice(8))}</span>
                    <span className="dots">
                      {list.slice(0, 3).map(x => (
                        <span key={x.id} className={`ddot ${x.status === 'done' ? 'done' : ''}`} style={{ background: catById(x.category_id)?.color || 'var(--ink)' }} />
                      ))}
                      {entriesByDay[d]?.length ? <span className="ddot ring" /> : null}
                    </span>
                    <span className="dtitles">
                      {list.slice(0, 2).map(x => <span key={x.id} className={x.status === 'done' ? 'done' : ''}>{x.title}</span>)}
                      {list.length > 2 && <span className="more">+{list.length - 2} more</span>}
                    </span>
                    {late && <span className="late-flag" />}
                  </button>
                );
              })}
            </div>
            <p className="legend"><span className="ddot" style={{ background: 'var(--ink)' }} /> task or event <span className="ddot ring" /> conversation captured</p>
          </div>

          <section className="block day-panel">
            <div className="block-head">
              <h2>{dayLabel(picked)}</h2>
              <button className="btn small" onClick={() => open('item', { due_date: picked })}><Icon d={I.plus} size={16} /> Add</button>
            </div>
            {dayItems.length === 0 && dayEntries.length === 0 && <Empty title="Nothing on this day." />}
            {dayItems.map(i => <ItemRow key={i.id} it={i} showDate={false} onOpen={x => open('item', x)} />)}
            {dayEntries.length > 0 && <p className="mono group">Conversations</p>}
            {dayEntries.map(e => <EntryCard key={e.id} e={e} onOpen={x => open('entry', x)} />)}
          </section>
        </div>
      )}

      {view === 'agenda' && (
        <section className="block">
          {agenda.length === 0 && <Empty title="Nothing in the next 30 days.">Add something, or capture a conversation.</Empty>}
          {agenda.map(d => (
            <div key={d} className="agenda-day">
              <p className={`mono group ${d === t ? 'today' : ''}`}>{dayLabel(d)}</p>
              {(byDay[d] || []).map(i => <ItemRow key={i.id} it={i} showDate={false} onOpen={x => open('item', x)} />)}
              {(entriesByDay[d] || []).map(e => <EntryCard key={e.id} e={e} onOpen={x => open('entry', x)} />)}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
