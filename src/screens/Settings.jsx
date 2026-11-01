import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { pushState, enablePush, disablePush, testPush, isIOS, isInstalled } from '../lib/push';
import { supabase } from '../lib/supabase';

const COLORS = ['#3b6fb6', '#c47a2b', '#8b5cb8', '#5f8a3a', '#c2453a', '#2a8a86', '#6f6a60', '#b8902a'];

export default function Settings({ push, setPush }) {
  const { profile, saveProfile, categories, saveCategory, deleteCategory, flash, user } = useStore();
  const [f, setF] = useState(() => ({ name: profile.name, role: profile.role || '', summary_style: profile.summary_style, remind_minutes: profile.remind_minutes, allday_hour: profile.allday_hour, timezone: profile.timezone }));
  const [dirty, setDirty] = useState(false);
  const [cat, setCat] = useState(null);
  const [err, setErr] = useState('');
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setDirty(true); };

  useEffect(() => { pushState().then(setPush); }, [setPush]);

  async function save(e) {
    e.preventDefault();
    if (!f.name.trim()) return setErr('Your name is used to work out what’s yours in conversations.');
    try { await saveProfile({ ...f, name: f.name.trim(), role: f.role.trim() || null }); setDirty(false); setErr(''); flash('Saved'); }
    catch (x) { setErr(x.message); }
  }
  async function togglePush() {
    try { setPush(push === 'on' ? await disablePush() : await enablePush()); }
    catch (x) { flash(x.message); }
  }
  async function saveCat(e) {
    e.preventDefault();
    try { await saveCategory(cat); setCat(null); } catch (x) { flash(x.message); }
  }
  async function removeCat(c) {
    if (!window.confirm(`Delete "${c.name}"? Items in it just lose the category.`)) return;
    try { await deleteCategory(c); setCat(null); } catch (x) { flash(x.message); }
  }
  const zones = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return [f.timezone]; } })();

  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>

      <form className="panel form" onSubmit={save}>
        <p className="mono group">You</p>
        <div className="grid2">
          <label className="field"><span>Your name, as people say it</span><input type="text" value={f.name} onChange={e => set('name', e.target.value)} /></label>
          <label className="field"><span>Role (optional)</span><input type="text" placeholder="Founder, Product manager…" value={f.role} onChange={e => set('role', e.target.value)} /></label>
        </div>
        <span className="field-label">Summaries</span>
        <div className="seg wide">
          <button type="button" className={f.summary_style === 'short' ? 'on' : ''} onClick={() => set('summary_style', 'short')}>Short</button>
          <button type="button" className={f.summary_style === 'detailed' ? 'on' : ''} onClick={() => set('summary_style', 'detailed')}>Detailed</button>
        </div>
        <p className="mono group">Reminders</p>
        <div className="grid2">
          <label className="field"><span>For timed items</span>
            <select value={f.remind_minutes} onChange={e => set('remind_minutes', Number(e.target.value))}>
              {[[0, 'At the time'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before'], [120, '2 hours before']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
          <label className="field"><span>For all-day items, remind me at</span>
            <select value={f.allday_hour} onChange={e => set('allday_hour', Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${((h + 11) % 12) + 1}:00 ${h < 12 ? 'am' : 'pm'}`}</option>)}
            </select></label>
          <label className="field"><span>Time zone</span>
            <select value={f.timezone} onChange={e => set('timezone', e.target.value)}>
              {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </select></label>
        </div>
        <p className="hint">Overdue items get one nudge the next morning, at your all-day time.</p>
        {err && <p className="error">{err}</p>}
        {dirty && <div className="row end"><button className="btn">Save</button></div>}
      </form>

      <section className="panel">
        <p className="mono group">Notifications on this device</p>
        {push === 'install-first' ? (
          <p className="hint">On iPhone, reminders work once Minutes is on your Home Screen: open this site in Safari → Share → <b>Add to Home Screen</b>, then open it from there and turn them on.</p>
        ) : push === 'unsupported' ? (
          <p className="hint">This browser can’t show reminders. Try Chrome, Edge or Safari.</p>
        ) : push === 'blocked' ? (
          <p className="hint">Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.</p>
        ) : (
          <div className="row wrap">
            <button className={`btn ${push === 'on' ? 'ghost' : ''}`} onClick={togglePush}>{push === 'on' ? 'Turn off on this device' : 'Turn on reminders'}</button>
            {push === 'on' && <button className="btn ghost" onClick={() => testPush().then(() => flash('Sent a test')).catch(x => flash(x.message))}>Send a test</button>}
          </div>
        )}
        <p className="hint">Turn them on separately on your phone and your laptop.{isIOS() && isInstalled() ? ' You’re using the Home Screen app.' : ''}</p>
      </section>

      <section className="panel">
        <div className="block-head"><p className="mono group">Categories</p>
          <button className="link" onClick={() => setCat({ name: '', color: COLORS[categories.length % COLORS.length] })}>Add</button></div>
        {categories.map(c => (
          <div className="cat-row" key={c.id}>
            <span className="cdot big" style={{ background: c.color }} />
            <span className="grow">{c.name}</span>
            <button className="link" onClick={() => setCat({ ...c })}>Edit</button>
          </div>
        ))}
        {cat && (
          <form className="task-edit" onSubmit={saveCat}>
            <input type="text" placeholder="Category name" value={cat.name} autoFocus maxLength={40} onChange={e => setCat(x => ({ ...x, name: e.target.value }))} />
            <div className="swatches">
              {COLORS.map(col => (
                <button type="button" key={col} aria-label={`Colour ${col}`} className={`swatch ${cat.color === col ? 'on' : ''}`} style={{ background: col }} onClick={() => setCat(x => ({ ...x, color: col }))} />
              ))}
            </div>
            <div className="row end">
              {cat.id && <button type="button" className="link danger" onClick={() => removeCat(cat)}>Delete</button>}
              <button type="button" className="btn ghost small" onClick={() => setCat(null)}>Cancel</button>
              <button className="btn small">Save</button>
            </div>
          </form>
        )}
      </section>

      <section className="panel">
        <p className="mono group">Account</p>
        <p className="hint">Signed in as {user.email}</p>
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </section>
    </>
  );
}
