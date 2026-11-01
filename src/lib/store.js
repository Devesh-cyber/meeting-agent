// All of your data in one place, with the actions the screens use.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { post, localZone } from './util';

export const Store = createContext(null);
export const useStore = () => useContext(Store);

const ENTRY_COLS = 'id, kind, title, title_locked, category_id, started_at, duration_sec, audio_path, transcript, speaker_map, note_text, summary, status, error, created_at';

export function useData(user, flash) {
  const [profile, setProfile] = useState(null);
  const [categories, setCategories] = useState([]);
  const [entries, setEntries] = useState([]);
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const uid = user?.id;

  const load = useCallback(async () => {
    if (!uid) return;
    const since = new Date(Date.now() - 180 * 86400000).toISOString();
    const [p, c, e, i] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('categories').select('*').order('sort').order('name'),
      supabase.from('entries').select(ENTRY_COLS).order('started_at', { ascending: false }).limit(300),
      supabase.from('items').select('*').or(`status.neq.done,done_at.gte.${since}`).order('due_date', { ascending: true, nullsFirst: false }).limit(1000),
    ]);
    if (p.error || c.error || e.error || i.error) {
      setLoadError('Could not load your data. Check that the database setup has been run.');
      return;
    }
    setLoadError('');
    setProfile(p.data); setCategories(c.data || []); setEntries(e.data || []); setItems(i.data || []);
    setReady(true);
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  // Keep fresh when you come back to the app
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  // While anything is still being transcribed, nudge it along and refresh
  const busy = entries.filter(e => e.status === 'processing' || e.status === 'finalizing').map(e => e.id).join(',');
  const polling = useRef(false);
  useEffect(() => {
    if (!busy) return;
    const tick = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const ids = busy.split(',').slice(0, 3);
        const results = await Promise.all(ids.map(id => post('/api/process', { entryId: id, action: 'check' }).catch(() => null)));
        if (results.some(r => r && r.status !== 'processing' && r.status !== 'finalizing')) {
          await load();
          if (results.some(r => r?.status === 'ready')) flash('Your minutes are ready');
        }
      } finally { polling.current = false; }
    };
    const t = setInterval(tick, 6000);
    tick();
    return () => clearInterval(t);
  }, [busy, load, flash]);

  // ---------- actions ----------
  const catById = id => categories.find(c => c.id === id);

  async function saveProfile(fields) {
    const { data, error } = await supabase.from('profiles').update(fields).eq('id', uid).select('*').single();
    if (error) throw new Error('Could not save your settings');
    setProfile(data);
    // reminder times may have moved
    const { data: its } = await supabase.from('items').select('*').or(`status.neq.done`).limit(1000);
    if (its) setItems(prev => [...its, ...prev.filter(x => x.status === 'done')]);
  }

  async function saveItem(it) {
    const row = {
      title: (it.title || '').trim(), kind: it.kind || 'task', notes: it.notes || null, owner: it.owner || null,
      category_id: it.category_id || null, due_date: it.due_date || null,
      due_time: it.due_date && it.due_time ? it.due_time : null,
      end_time: it.due_date && it.due_time && it.end_time ? it.end_time : null,
      remind_offset_min: it.remind_offset_min ?? null, status: it.status || 'open',
    };
    if (!row.title) throw new Error('Give it a title');
    const q = it.id
      ? supabase.from('items').update(row).eq('id', it.id).select('*').single()
      : supabase.from('items').insert({ ...row, user_id: uid, entry_id: it.entry_id || null }).select('*').single();
    const { data, error } = await q;
    if (error) throw new Error('Could not save that');
    setItems(prev => (it.id ? prev.map(x => (x.id === it.id ? data : x)) : [...prev, data]));
    return data;
  }

  async function setItemStatus(it, status) {
    setItems(prev => prev.map(x => (x.id === it.id ? { ...x, status } : x)));
    const { data, error } = await supabase.from('items').update({ status }).eq('id', it.id).select('*').single();
    if (error) { flash('Could not update that. Try again.'); load(); return; }
    setItems(prev => prev.map(x => (x.id === it.id ? data : x)));
  }

  async function deleteItems(ids) {
    setItems(prev => prev.filter(x => !ids.includes(x.id)));
    const { error } = await supabase.from('items').delete().in('id', ids);
    if (error) { flash('Could not delete that'); load(); }
  }

  async function updateEntry(id, fields) {
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...fields } : e)));
    const { error } = await supabase.from('entries').update(fields).eq('id', id);
    if (error) { flash('Could not save that'); load(); }
  }

  async function deleteEntry(e) {
    setEntries(prev => prev.filter(x => x.id !== e.id));
    // Accepted tasks stay (unlinked); suggestions go with the entry
    await supabase.from('items').delete().eq('entry_id', e.id).eq('status', 'suggested');
    const { error } = await supabase.from('entries').delete().eq('id', e.id);
    if (e.audio_path) await supabase.storage.from('audio').remove([e.audio_path]);
    if (error) { flash('Could not delete that'); }
    load();
  }

  async function createRecording({ kind, path, duration, category_id, startedAt }) {
    const { data, error } = await supabase.from('entries').insert({
      user_id: uid, kind, audio_path: path, duration_sec: duration || null, category_id: category_id || null,
      started_at: startedAt || new Date().toISOString(), status: 'processing',
      title: kind === 'meeting' ? 'Meeting' : 'Conversation',
    }).select(ENTRY_COLS).single();
    if (error) throw new Error('Could not save the recording');
    setEntries(prev => [data, ...prev]);
    await post('/api/process', { entryId: data.id, action: 'start' }).catch(async err => {
      await supabase.from('entries').update({ status: 'failed', error: err.message }).eq('id', data.id);
      setEntries(prev => prev.map(e => (e.id === data.id ? { ...e, status: 'failed', error: err.message } : e)));
    });
    return data;
  }

  async function processEntry(id, action) {
    const r = await post('/api/process', { entryId: id, action });
    await load();
    return r;
  }

  async function saveCategory(c) {
    const row = { name: c.name.trim(), color: c.color };
    if (!row.name) throw new Error('Name it');
    const q = c.id
      ? supabase.from('categories').update(row).eq('id', c.id).select('*').single()
      : supabase.from('categories').insert({ ...row, user_id: uid, sort: categories.length + 1 }).select('*').single();
    const { data, error } = await q;
    if (error) throw new Error(error.code === '23505' ? 'You already have a category with that name' : 'Could not save the category');
    setCategories(prev => (c.id ? prev.map(x => (x.id === c.id ? data : x)) : [...prev, data]));
  }

  async function deleteCategory(c) {
    const { error } = await supabase.from('categories').delete().eq('id', c.id);
    if (error) throw new Error('Could not delete the category');
    setCategories(prev => prev.filter(x => x.id !== c.id));
    setItems(prev => prev.map(x => (x.category_id === c.id ? { ...x, category_id: null } : x)));
    setEntries(prev => prev.map(x => (x.category_id === c.id ? { ...x, category_id: null } : x)));
  }

  // First sign-in on a device: make sure your time zone is right
  useEffect(() => {
    if (profile && profile.timezone !== localZone() && !sessionStorage.getItem('tz-checked')) {
      sessionStorage.setItem('tz-checked', '1');
      supabase.from('profiles').update({ timezone: localZone() }).eq('id', uid).select('*').single()
        .then(({ data }) => data && setProfile(data));
    }
  }, [profile, uid]);

  return {
    ready, loadError, user, profile, categories, entries, items, catById, load, flash,
    saveProfile, saveItem, setItemStatus, deleteItems, updateEntry, deleteEntry, createRecording, processEntry,
    saveCategory, deleteCategory, setItems,
  };
}
