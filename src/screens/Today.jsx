import { useStore } from '../lib/store';
import { today, dateOf, greeting, byWhen, daysFrom, dayLabel } from '../lib/util';
import { ItemRow, EntryCard, Empty } from '../Parts';
import { Icon, I } from '../Icons';

export default function Today({ open, push, onEnablePush }) {
  const { profile, items, entries } = useStore();
  const t = today();
  const live = items.filter(i => i.status === 'open');
  const overdue = live.filter(i => i.due_date && daysFrom(i.due_date) < 0).sort(byWhen);
  const todays = live.filter(i => i.due_date === t).sort(byWhen);
  const soon = live.filter(i => i.due_date && daysFrom(i.due_date) >= 1 && daysFrom(i.due_date) <= 3).sort(byWhen);
  const captured = entries.filter(e => dateOf(e.started_at) === t);
  const review = items.filter(i => i.status === 'suggested').length;
  const first = (profile?.name || '').split(' ')[0];
  const count = todays.length + overdue.length;

  return (
    <>
      <h1 className="hero">
        {greeting()}{first ? `, ${first}` : ''}.<br />
        <em>{count === 0 ? 'Nothing due today.' : `${count} thing${count > 1 ? 's' : ''} today.`}</em>
      </h1>

      <div className="capture-row">
        <button className="cap hot" onClick={() => open('record')}><Icon d={I.mic} size={24} /><span>Record</span></button>
        <button className="cap" onClick={() => open('note')}><Icon d={I.note} size={24} /><span>Note to self</span></button>
        <button className="cap" onClick={() => open('upload')}><Icon d={I.upload} size={24} /><span>Upload</span></button>
      </div>

      {(push === 'off' || push === 'install-first') && (
        <div className="banner">
          <span>{push === 'install-first' ? 'On iPhone, add Minutes to your Home Screen to get reminders.' : 'Turn on reminders so nothing slips, even when the app is closed.'}</span>
          {push === 'off' && <button className="btn small" onClick={onEnablePush}>Turn on</button>}
        </div>
      )}

      {review > 0 && (
        <button className="banner review" onClick={() => open('review')}>
          <span><b>{review} follow-up{review > 1 ? 's' : ''}</b> from your conversations to review</span>
          <Icon d={I.right} />
        </button>
      )}

      <div className="today-grid">
        <section className="block">
          <div className="block-head"><h2>Today’s schedule</h2><button className="link" onClick={() => open('item', { due_date: t })}>Add</button></div>
          {overdue.length > 0 && (
            <>
              <p className="mono group danger">Overdue · {overdue.length}</p>
              {overdue.map(i => <ItemRow key={i.id} it={i} onOpen={x => open('item', x)} />)}
              <p className="mono group">Today</p>
            </>
          )}
          {todays.length === 0 && <Empty title="A clear day.">Add something, or say it in a note to self.</Empty>}
          {todays.map(i => <ItemRow key={i.id} it={i} showDate={false} onOpen={x => open('item', x)} />)}
          {soon.length > 0 && (
            <>
              <p className="mono group">Next few days</p>
              {soon.map(i => <ItemRow key={i.id} it={i} onOpen={x => open('item', x)} />)}
            </>
          )}
        </section>

        <section className="block">
          <div className="block-head"><h2>Captured today</h2><button className="link" onClick={() => open('tab', 'library')}>Library</button></div>
          {captured.length === 0 && <Empty title="Nothing captured yet today.">Tap Record when a conversation starts.</Empty>}
          {captured.map(e => <EntryCard key={e.id} e={e} onOpen={x => open('entry', x)} />)}
          {captured.length === 0 && entries.length > 0 && (
            <>
              <p className="mono group">Most recent · {dayLabel(dateOf(entries[0].started_at))}</p>
              <EntryCard e={entries[0]} onOpen={x => open('entry', x)} />
            </>
          )}
        </section>
      </div>
    </>
  );
}
