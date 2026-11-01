import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import { Store, useData } from './lib/store';
import { pushState, enablePush, registerSW } from './lib/push';
import { Icon, I } from './Icons';
import { CaptureMenu, RecordSheet, NoteSheet, UploadSheet, ItemSheet } from './Sheets';
import Auth from './screens/Auth';
import Today from './screens/Today';
import Calendar from './screens/Calendar';
import Tasks from './screens/Tasks';
import Library from './screens/Library';
import Entry from './screens/Entry';
import Settings from './screens/Settings';
import './App.css';

const TABS = [['today', 'Today', I.home], ['calendar', 'Calendar', I.calendar], ['tasks', 'Tasks', I.tasks], ['library', 'Library', I.library]];

export default function App() {
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'USER_UPDATED') setRecovery(false);
      setSession(s);
    });
    registerSW();
    return () => sub.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="boot"><div className="spinner" /></div>;
  if (!session || recovery) return <Auth recovery={recovery} />;
  return <Home key={session.user.id} user={session.user} />;
}

function Home({ user }) {
  const [toast, setToast] = useState('');
  const tt = useRef(null);
  const flash = useCallback(msg => {
    setToast(msg); clearTimeout(tt.current);
    tt.current = setTimeout(() => setToast(''), 3500);
  }, []);
  const store = useData(user, flash);

  const params = new URLSearchParams(window.location.search);
  const [tab, setTab] = useState(() => (TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'today'));
  const [tasksInitial, setTasksInitial] = useState(null);
  const [entryId, setEntryId] = useState(() => params.get('entry'));
  const [sheet, setSheet] = useState(() => (params.get('go') === 'record' ? 'record' : params.get('go') === 'note' ? 'note' : null));
  const [item, setItem] = useState(null);
  const [pendingItem, setPendingItem] = useState(() => params.get('item'));
  const [push, setPush] = useState('off');

  useEffect(() => { pushState().then(setPush); }, []);
  useEffect(() => {
    if (params.get('entry') || params.get('item') || params.get('tab')) window.history.replaceState(null, '', window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from a reminder about a specific item
  useEffect(() => {
    if (!pendingItem || !store.ready) return;
    const it = store.items.find(x => x.id === pendingItem);
    if (it) setItem(it);
    setPendingItem(null);
  }, [pendingItem, store.ready, store.items]);

  // Tapping a notification while the app is already open
  useEffect(() => {
    const onMsg = e => {
      if (!e.data?.open) return;
      const u = new URL(e.data.open);
      if (u.searchParams.get('entry')) { setEntryId(u.searchParams.get('entry')); store.load(); }
      else if (u.searchParams.get('item')) setPendingItem(u.searchParams.get('item'));
      else if (u.searchParams.get('tab')) go(u.searchParams.get('tab'));
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  function go(t) { setTab(t); setEntryId(null); setTasksInitial(null); window.scrollTo(0, 0); }
  function open(kind, arg) {
    if (kind === 'entry') { setEntryId(arg.id); window.scrollTo(0, 0); }
    else if (kind === 'item') { setSheet(null); setItem(arg || {}); }
    else if (kind === 'tab') go(arg);
    else if (kind === 'review') { setTab('tasks'); setEntryId(null); setTasksInitial('review'); window.scrollTo(0, 0); }
    else setSheet(kind);
  }
  async function turnOnPush() {
    try { setPush(await enablePush()); flash('Reminders are on for this device'); }
    catch (e) { flash(e.message); }
  }

  if (store.loadError) return <div className="boot"><p className="error">{store.loadError}</p></div>;
  if (!store.ready || !store.profile) return <div className="boot"><div className="spinner" /></div>;
  const reviewCount = store.items.filter(i => i.status === 'suggested').length;
  const initials = store.profile.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <Store.Provider value={store}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand"><span className="dot" />Minutes</div>
          <button className="btn record-cta" onClick={() => setSheet('record')}><Icon d={I.mic} size={18} /> Record</button>
          <button className="btn ghost new-cta" onClick={() => setSheet('menu')}><Icon d={I.plus} size={18} /> New</button>
          <nav>
            {TABS.map(([k, l, d]) => (
              <button key={k} className={tab === k && !entryId ? 'on' : ''} onClick={() => go(k)}>
                <Icon d={d} />{l}{k === 'tasks' && reviewCount > 0 && <span className="nav-count">{reviewCount}</span>}
              </button>
            ))}
          </nav>
          <button className={`side-settings ${tab === 'settings' ? 'on' : ''}`} onClick={() => go('settings')}>
            <span className="avatar">{initials}</span><span>{store.profile.name}<span className="sub">Settings</span></span>
          </button>
        </aside>

        <div className="main">
          <header className="topbar">
            <div className="topbar-row">
              <div className="brand"><span className="dot" />Minutes</div>
              <span className="mono date">{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <button className={`avatar-btn ${tab === 'settings' ? 'on' : ''}`} aria-label="Settings" onClick={() => go('settings')}>{initials}</button>
            </div>
            <nav className="topnav" aria-label="Sections">
              {TABS.map(([k, l, d]) => (
                <button key={k} className={tab === k && !entryId ? 'on' : ''} onClick={() => go(k)}>
                  <Icon d={d} size={18} /><span>{l}</span>{k === 'tasks' && reviewCount > 0 && <span className="nav-count">{reviewCount}</span>}
                </button>
              ))}
            </nav>
          </header>

          <main className="content">
            {entryId ? (
              <Entry id={entryId} open={open} onBack={() => setEntryId(null)} />
            ) : (
              <>
                {tab === 'today' && <Today open={open} push={push} onEnablePush={turnOnPush} />}
                {tab === 'calendar' && <Calendar open={open} />}
                {tab === 'tasks' && <Tasks key={tasksInitial || 'all'} open={open} initial={tasksInitial} />}
                {tab === 'library' && <Library open={open} />}
                {tab === 'settings' && <Settings push={push} setPush={setPush} />}
              </>
            )}
          </main>
        </div>

        <button className="fab" aria-label="Capture" onClick={() => setSheet('menu')}><Icon d={I.plus} size={26} stroke={2} /></button>

        {sheet === 'menu' && <CaptureMenu onClose={() => setSheet(null)} onPick={k => (k === 'item' ? open('item', {}) : setSheet(k))} />}
        {sheet === 'record' && <RecordSheet onClose={() => setSheet(null)} />}
        {sheet === 'upload' && <UploadSheet onClose={() => setSheet(null)} />}
        {sheet === 'note' && <NoteSheet onClose={() => setSheet(null)} onOpenItem={it => open('item', it)} />}
        {item && <ItemSheet key={item.id || 'new'} item={item} onClose={() => setItem(null)} onOpenEntry={e => { setItem(null); open('entry', e); }} />}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </Store.Provider>
  );
}
