// One conversation, meeting or note: its own minutes, follow-ups, decisions and transcript.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../lib/store';
import { clock, dayLabel, dateOf, duration } from '../lib/util';
import { ItemRow } from '../Parts';
import { ReviewList } from './Tasks';
import { CategoryPicker } from '../Sheets';
import { Icon, I } from '../Icons';

const speakerLabel = (s, map) => map?.[s] || (String(s).length === 1 ? `Speaker ${s}` : s);

export default function Entry({ id, open, onBack }) {
  const { entries, items, catById, updateEntry, deleteEntry, processEntry, flash } = useStore();
  const e = entries.find(x => x.id === id);
  const [decisions, setDecisions] = useState([]);
  const [editTitle, setEditTitle] = useState(null);
  const [showT, setShowT] = useState(false);
  const [names, setNames] = useState(null);
  const [catEdit, setCatEdit] = useState(false);
  const [busy, setBusy] = useState('');

  const loadDecisions = useCallback(async () => {
    const { data } = await supabase.from('entry_decisions').select('id, text, made_by, status, conflict_with, conflict_note, superseded_by').eq('entry_id', id).order('created_at');
    const conflictIds = (data || []).map(d => d.conflict_with).filter(Boolean);
    let old = [];
    if (conflictIds.length) old = (await supabase.from('entry_decisions').select('id, text, status, entry_id').in('id', conflictIds)).data || [];
    setDecisions((data || []).map(d => ({ ...d, old: old.find(o => o.id === d.conflict_with) })));
  }, [id]);
  useEffect(() => { if (e?.status === 'ready') loadDecisions(); }, [e?.status, loadDecisions]);

  if (!e) return <div className="working"><div className="spinner" /></div>;
  const cat = catById(e.category_id);
  const mine = items.filter(i => i.entry_id === e.id && i.status !== 'suggested');
  const working = e.status === 'processing' || e.status === 'finalizing';
  const label = { meeting: 'Meeting', conversation: 'Conversation', note: 'Note to self' }[e.kind];
  const speakers = [...new Set((e.transcript || []).map(u => u.speaker))];

  async function resolve(d, replace) {
    if (replace) {
      await supabase.from('entry_decisions').update({ status: 'superseded', superseded_by: d.id }).eq('id', d.conflict_with);
    }
    await supabase.from('entry_decisions').update({ conflict_with: null, conflict_note: null }).eq('id', d.id);
    flash(replace ? 'Old decision replaced' : 'Kept both');
    loadDecisions();
  }
  async function saveNames(rerun) {
    await updateEntry(e.id, { speaker_map: names });
    setNames(null);
    if (rerun) await run('rerun');
  }
  async function run(action) {
    setBusy(action === 'rerun' ? 'Rewriting the minutes' : 'Retrying');
    try { await processEntry(e.id, action); if (action === 'rerun') loadDecisions(); }
    catch (x) { flash(x.message); }
    setBusy('');
  }
  async function remove() {
    if (!window.confirm('Delete this entry and its recording? Tasks you already added stay on your list.')) return;
    await deleteEntry(e); onBack();
  }

  return (
    <article className="entry">
      <div className="entry-top">
        <button className="icon-btn" aria-label="Back" onClick={onBack}><Icon d={I.back} /></button>
        <span className="mono">{label} · {dayLabel(dateOf(e.started_at))} · {clock(e.started_at)}</span>
        <button className="icon-btn danger" aria-label="Delete entry" onClick={remove}><Icon d={I.trash} /></button>
      </div>

      {editTitle === null ? (
        <h1 className="entry-title" onClick={() => setEditTitle(e.title || '')} title="Tap to rename">{e.title || label}</h1>
      ) : (
        <form onSubmit={ev => { ev.preventDefault(); updateEntry(e.id, { title: editTitle.trim() || e.title, title_locked: true }); setEditTitle(null); }}>
          <input className="big-input" value={editTitle} autoFocus onChange={ev => setEditTitle(ev.target.value)} onBlur={ev => ev.currentTarget.form.requestSubmit()} />
        </form>
      )}
      <div className="chips wrap">
        <button className="chip" onClick={() => setCatEdit(c => !c)}>
          <span className="cdot" style={{ background: cat?.color || 'var(--line)' }} />{cat?.name || 'No category'} ▾
        </button>
        {e.duration_sec ? <span className="chip static">{duration(e.duration_sec)}</span> : null}
        {speakers.length > 1 && <span className="chip static">{speakers.length} voices</span>}
      </div>
      {catEdit && <CategoryPicker value={e.category_id} allowNone={false} onChange={v => { updateEntry(e.id, { category_id: v }); setCatEdit(false); }} />}

      {working && (
        <div className="panel working-panel">
          <div className="spinner" />
          <div><b>Writing your minutes…</b><span className="sub">Usually a minute or two. You can close the app; you’ll get a notification.</span></div>
        </div>
      )}
      {e.status === 'failed' && (
        <div className="panel failed-panel">
          <b>Couldn’t finish this one.</b>
          <span className="sub">{e.error || 'Something went wrong.'}</span>
          <div className="row"><button className="btn small" disabled={!!busy} onClick={() => run('retry')}>{busy ? `${busy}…` : 'Try again'}</button></div>
        </div>
      )}

      {e.kind === 'note' && e.note_text && <p className="quote">“{e.note_text}”</p>}

      {e.summary && (
        <section className="block">
          <p className="mono group">Summary</p>
          <div className="summary-text">{e.summary.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>
        </section>
      )}

      <ReviewListWrap entryId={e.id} open={open} />

      {mine.length > 0 && (
        <section className="block">
          <p className="mono group">{e.kind === 'note' ? 'Added from this note' : 'On your list'}</p>
          {mine.map(i => <ItemRow key={i.id} it={i} onOpen={x => open('item', x)} />)}
        </section>
      )}

      {decisions.length > 0 && (
        <section className="block">
          <p className="mono group">Decisions</p>
          {decisions.map(d => (
            <div key={d.id}>
              <div className="decision">
                <span>{d.text}</span>
                {d.made_by && <span className="sub">{d.made_by}</span>}
              </div>
              {d.conflict_with && d.old && d.old.status === 'active' && (
                <div className="conflict">
                  <span className="mono">Changes an earlier decision</span>
                  <p><s>{d.old.text}</s></p>
                  {d.conflict_note && <p className="sub">{d.conflict_note}</p>}
                  <div className="row">
                    <button className="chip on" onClick={() => resolve(d, true)}>Replace old decision</button>
                    <button className="chip" onClick={() => resolve(d, false)}>Keep both</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {Array.isArray(e.transcript) && e.transcript.length > 0 && (
        <section className="block">
          <div className="block-head">
            <button className="mono group linkish" onClick={() => setShowT(s => !s)}>Transcript {showT ? '▾' : '▸'}</button>
            {speakers.length > 0 && names === null && <button className="link" onClick={() => setNames({ ...(e.speaker_map || {}) })}>Name speakers</button>}
          </div>
          {names !== null && (
            <div className="panel names">
              {speakers.map(s => (
                <label className="field" key={s}><span>{speakerLabel(s, {})}</span>
                  <input type="text" placeholder="Name" value={names[s] || ''} onChange={ev => setNames(n => ({ ...n, [s]: ev.target.value }))} />
                </label>
              ))}
              <div className="row end">
                <button className="btn ghost small" onClick={() => setNames(null)}>Cancel</button>
                <button className="btn ghost small" onClick={() => saveNames(false)}>Save names</button>
                <button className="btn small" disabled={!!busy} onClick={() => saveNames(true)}>Save and rewrite minutes</button>
              </div>
            </div>
          )}
          {showT && (
            <div className="transcript">
              {e.transcript.map((u, i) => <p key={i}><b>{speakerLabel(u.speaker, e.speaker_map)}</b> {u.text}</p>)}
            </div>
          )}
        </section>
      )}

      {e.status === 'ready' && e.kind !== 'note' && (
        <div className="row end entry-foot">
          <button className="link" disabled={!!busy} onClick={() => run('rerun')}><Icon d={I.refresh} size={14} /> {busy || 'Rewrite the minutes'}</button>
        </div>
      )}
    </article>
  );
}

function ReviewListWrap({ entryId, open }) {
  const { items } = useStore();
  const n = items.filter(i => i.entry_id === entryId && i.status === 'suggested').length;
  if (!n) return null;
  return (
    <section className="block">
      <p className="mono group accent">Follow-ups to review · {n}</p>
      <p className="hint">Add the ones you want on your list and calendar.</p>
      <ReviewList entryId={entryId} open={open} />
    </section>
  );
}
