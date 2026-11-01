import { useState } from 'react';
import { useStore } from '../lib/store';
import { daysFrom, byWhen, dayLabel, fmtTime } from '../lib/util';
import { ItemRow, CatFilter, Empty } from '../Parts';

export default function Tasks({ open, initial }) {
  const { items } = useStore();
  const [cat, setCat] = useState(null);
  const [show, setShow] = useState(initial === 'review' ? 'review' : 'all'); // all | tasks | events | waiting | review
  const [showDone, setShowDone] = useState(false);

  const review = items.filter(i => i.status === 'suggested');
  let list = items.filter(i => i.status !== 'suggested' && (!cat || i.category_id === cat));
  if (show === 'tasks') list = list.filter(i => i.kind === 'task' && !i.owner);
  if (show === 'events') list = list.filter(i => i.kind === 'event');
  if (show === 'waiting') list = list.filter(i => i.owner);

  const open_ = list.filter(i => i.status === 'open');
  const groups = [
    ['Overdue', open_.filter(i => i.due_date && daysFrom(i.due_date) < 0)],
    ['Today', open_.filter(i => i.due_date && daysFrom(i.due_date) === 0)],
    ['Upcoming', open_.filter(i => i.due_date && daysFrom(i.due_date) > 0)],
    ['Someday', open_.filter(i => !i.due_date)],
  ].map(([n, g]) => [n, g.sort(byWhen)]);
  const done = list.filter(i => i.status === 'done').sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));

  return (
    <>
      <div className="page-head">
        <h1>Tasks</h1>
        <button className="btn small" onClick={() => open('item', {})}>Add</button>
      </div>
      <div className="chips">
        {[['all', 'Everything'], ['tasks', 'My tasks'], ['events', 'Events'], ['waiting', 'Waiting on others']].map(([k, l]) => (
          <button key={k} className={`chip ${show === k ? 'on' : ''}`} onClick={() => setShow(k)}>{l}</button>
        ))}
        {review.length > 0 && (
          <button className={`chip accent ${show === 'review' ? 'on' : ''}`} onClick={() => setShow('review')}>To review · {review.length}</button>
        )}
      </div>

      {show === 'review' ? (
        <ReviewList open={open} />
      ) : (
        <>
          <CatFilter value={cat} onChange={setCat} />
          {open_.length === 0 && done.length === 0 && <Empty title="Nothing here yet.">Tasks from your conversations and notes show up here.</Empty>}
          {groups.filter(([, g]) => g.length).map(([n, g]) => (
            <section className="block" key={n}>
              <p className={`mono group ${n === 'Overdue' ? 'danger' : ''}`}>{n} · {g.length}</p>
              {g.map(i => <ItemRow key={i.id} it={i} onOpen={x => open('item', x)} />)}
            </section>
          ))}
          {done.length > 0 && (
            <section className="block">
              <button className="mono group linkish" onClick={() => setShowDone(s => !s)}>Done · {done.length} {showDone ? '▾' : '▸'}</button>
              {showDone && done.slice(0, 50).map(i => <ItemRow key={i.id} it={i} onOpen={x => open('item', x)} />)}
            </section>
          )}
        </>
      )}
    </>
  );
}

// Follow-ups the AI found in conversations, waiting for a yes or no
export function ReviewList({ open, entryId }) {
  const { items, entries, catById, saveItem, deleteItems, flash } = useStore();
  const list = items.filter(i => i.status === 'suggested' && (!entryId || i.entry_id === entryId)).sort(byWhen);
  const byEntry = entryId ? { [entryId]: list } : list.reduce((m, i) => ((m[i.entry_id] ||= []).push(i), m), {});

  async function accept(its) {
    await Promise.all(its.map(i => saveItem({ ...i, status: 'open' })));
    flash(its.length > 1 ? `Added ${its.length} items` : 'Added');
  }
  if (!list.length) return entryId ? null : <Empty title="All caught up.">Nothing waiting for review.</Empty>;
  return Object.entries(byEntry).map(([eid, its]) => {
    const e = entries.find(x => x.id === eid);
    return (
      <section className="block review-block" key={eid}>
        {!entryId && (
          <div className="block-head">
            <button className="link strong" onClick={() => e && open('entry', e)}>{e?.title || 'Conversation'}</button>
            <button className="btn small" onClick={() => accept(its)}>Add all {its.length}</button>
          </div>
        )}
        {its.map(i => (
          <div className="sug" key={i.id}>
            <button className="sug-body" onClick={() => open('item', i)}>
              <span className="irow-title">{i.title}</span>
              <span className="irow-meta">
                {catById(i.category_id) && <><span className="cdot" style={{ background: catById(i.category_id).color }} />{catById(i.category_id).name}</>}
                {i.owner && <span className="tag">waiting on {i.owner}</span>}
                <span>{i.due_date ? `${dayLabel(i.due_date)}${i.due_time ? ' · ' + fmtTime(i.due_time) : ''}` : 'No date'}</span>
              </span>
            </button>
            <div className="sug-actions">
              <button className="link" onClick={() => deleteItems([i.id])}>Dismiss</button>
              <button className="btn small" onClick={() => accept([i])}>Add</button>
            </div>
          </div>
        ))}
        {entryId && list.length > 1 && <div className="row end"><button className="btn small" onClick={() => accept(list)}>Add all {list.length}</button></div>}
      </section>
    );
  });
}
