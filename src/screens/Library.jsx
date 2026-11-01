import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import { dateOf, dayLabel } from '../lib/util';
import { EntryCard, CatFilter, Empty } from '../Parts';
import { Icon, I } from '../Icons';

export default function Library({ open }) {
  const { entries } = useStore();
  const [cat, setCat] = useState(null);
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState('entries');

  const needle = q.trim().toLowerCase();
  const list = entries.filter(e =>
    (!cat || e.category_id === cat) && (kind === 'all' || e.kind === kind) &&
    (!needle || [e.title, e.summary, e.note_text].some(t => (t || '').toLowerCase().includes(needle)) ||
      (needle && (e.transcript || []).some(u => (u.text || '').toLowerCase().includes(needle)))));
  const groups = list.reduce((m, e) => ((m[dateOf(e.started_at)] ||= []).push(e), m), {});

  return (
    <>
      <div className="page-head">
        <h1>Library</h1>
        <div className="seg">
          <button className={view === 'entries' ? 'on' : ''} onClick={() => setView('entries')}>Conversations</button>
          <button className={view === 'decisions' ? 'on' : ''} onClick={() => setView('decisions')}>Decisions</button>
        </div>
      </div>
      {view === 'entries' ? (
        <>
          <label className="search">
            <Icon d={I.search} size={18} />
            <input type="search" placeholder="Search titles, summaries and transcripts" value={q} onChange={e => setQ(e.target.value)} />
          </label>
          <div className="chips">
            {[['all', 'All'], ['meeting', 'Meetings'], ['conversation', 'Conversations'], ['note', 'Notes']].map(([k, l]) => (
              <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
          <CatFilter value={cat} onChange={setCat} />
          {list.length === 0 && <Empty title={entries.length ? 'No matches.' : 'Nothing captured yet.'}>{entries.length ? 'Try another word or filter.' : 'Your recordings and notes will live here, by day.'}</Empty>}
          {Object.entries(groups).map(([d, es]) => (
            <section className="block" key={d}>
              <p className="mono group">{dayLabel(d)}</p>
              {es.map(e => <EntryCard key={e.id} e={e} onOpen={x => open('entry', x)} />)}
            </section>
          ))}
        </>
      ) : <DecisionLog open={open} />}
    </>
  );
}

function DecisionLog({ open }) {
  const { entries } = useStore();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    supabase.from('entry_decisions').select('id, text, made_by, status, superseded_by, entry_id, created_at')
      .order('created_at', { ascending: false }).limit(300).then(({ data }) => setRows(data || []));
  }, []);
  if (!rows) return <div className="working"><div className="spinner" /></div>;
  if (!rows.length) return <Empty title="No decisions yet.">Decisions from your meetings and conversations collect here.</Empty>;
  const byId = new Map(rows.map(r => [r.id, r]));
  return (
    <section className="block">
      {rows.map(d => {
        const e = entries.find(x => x.id === d.entry_id);
        const replaced = rows.find(r => r.superseded_by === d.id);
        return (
          <div className={`decision ${d.status === 'superseded' ? 'old' : ''}`} key={d.id}>
            {d.status === 'superseded' ? <s>{d.text}</s> : <span>{d.text}</span>}
            {replaced && <span className="was">replaced <s>{replaced.text}</s></span>}
            {d.status === 'superseded' && byId.get(d.superseded_by) && <span className="sub">→ {byId.get(d.superseded_by).text}</span>}
            <button className="sub linkish" onClick={() => e && open('entry', e)}>
              {[d.made_by, e?.title, dayLabel(dateOf(d.created_at))].filter(Boolean).join(' · ')}
            </button>
          </div>
        );
      })}
    </section>
  );
}
