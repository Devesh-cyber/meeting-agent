import { useEffect, useRef, useState } from 'react';
import { supabase } from './lib/supabase';
import './App.css';

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local
const label = s => (s.length === 1 ? `Speaker ${s}` : s);

async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || d.error || 'Request failed');
  return d;
}

function parsePasted(text) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const m = l.match(/^([A-Za-z][\w .]{0,30}):\s*(.+)$/);
      return m ? { speaker: m[1].trim(), text: m[2] } : { speaker: 'Unknown', text: l };
    });
}

export default function App() {
  const [tab, setTab] = useState('record');
  const [title, setTitle] = useState('');
  const [stage, setStage] = useState('input'); // input | working | speakers | review
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [source, setSource] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [utterances, setUtterances] = useState([]);
  const [speakerMap, setSpeakerMap] = useState({});
  const [result, setResult] = useState(null);
  const [pasted, setPasted] = useState('');
  const [tasks, setTasks] = useState([]);
  const [log, setLog] = useState([]);

  useEffect(() => { loadBoard(); }, []);

  async function loadBoard() {
    const { data: t } = await supabase
      .from('action_items')
      .select('*, meetings(title)')
      .order('deadline', { ascending: true, nullsFirst: false });
    const { data: d } = await supabase
      .from('decisions')
      .select('id, text, made_by, status, created_at, meetings(title)')
      .order('created_at', { ascending: false })
      .limit(30);
    setTasks(t || []);
    setLog(d || []);
  }

  function reset() {
    setStage('input'); setTitle(''); setSource(null); setAudioUrl(null);
    setUtterances([]); setSpeakerMap({}); setResult(null); setPasted(''); setStatus('');
  }

  function fail(e, back = 'input') {
    setError(e.message || String(e));
    setStage(back);
  }

  function toSpeakers(utts, src) {
    setUtterances(utts);
    setSource(src);
    const map = {};
    utts.forEach(u => {
      if (!(u.speaker in map)) map[u.speaker] = u.speaker.length === 1 ? '' : u.speaker;
    });
    setSpeakerMap(map);
    setStage('speakers');
  }

  async function handleAudio(blob, src) {
    setError(''); setStage('working');
    try {
      if (!blob.size) throw new Error('The recording came out empty. Try again and record for a few seconds.');

      setStatus('Uploading audio');
      const ext = blob.name
        ? blob.name.split('.').pop()
        : (blob.type.split('/')[1] || 'webm').split(';')[0];
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('recordings')
        .upload(path, blob, { contentType: blob.type || 'audio/webm' });
      if (upErr) throw upErr;
      const url = supabase.storage.from('recordings').getPublicUrl(path).data.publicUrl;
      setAudioUrl(url);

      setStatus('Transcribing and separating speakers');
      const { id } = await post('/api/transcribe', { audioUrl: url });
      let res;
      do {
        await new Promise(r => setTimeout(r, 3000));
        const r = await fetch(`/api/transcript-status?id=${id}`);
        res = await r.json();
        if (!r.ok) throw new Error(res.error || 'Transcription failed');
      } while (res.status !== 'completed');

      if (!res.utterances.length) throw new Error('No speech detected in this recording.');
      toSpeakers(res.utterances, src);
    } catch (e) { fail(e); }
  }

  function handlePaste() {
    setError('');
    const utts = parsePasted(pasted);
    if (!utts.length) return setError('Paste or dictate some meeting text first.');
    toSpeakers(utts, 'text');
  }

  const named = () =>
    utterances.map(u => ({
      speaker: speakerMap[u.speaker]?.trim() || label(u.speaker),
      text: u.text,
    }));

  async function extract() {
    setError(''); setStage('working');
    setStatus('Pulling out decisions, owners and deadlines');
    try {
      const data = await post('/api/extract', { transcript: named(), meetingDate: today() });
      const decisions = (data.decisions || []).map(d => ({ ...d, keep: true }));

      setStatus('Checking against past decisions');
      const { data: past } = await supabase
        .from('decisions')
        .select('id, text, made_by, created_at, meetings(title)')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(60);

      if (decisions.length && past?.length) {
        const { conflicts } = await post('/api/conflicts', {
          newDecisions: decisions,
          pastDecisions: past,
        });
        conflicts.forEach(c => {
          decisions[c.new_index].conflict = { ...c, old: past.find(p => p.id === c.past_id) };
          decisions[c.new_index].supersede = true;
        });
      }

      setResult({
        summary: data.summary || '',
        decisions,
        actions: (data.action_items || []).map(a => ({ ...a, keep: true })),
      });
      setStage('review');
    } catch (e) { fail(e, 'speakers'); }
  }

  function edit(kind, i, field, value) {
    setResult(r => ({
      ...r,
      [kind]: r[kind].map((x, j) => (j === i ? { ...x, [field]: value } : x)),
    }));
  }

  async function confirm() {
    setError(''); setStage('working'); setStatus('Saving');
    try {
      const { data: m, error: mErr } = await supabase
        .from('meetings')
        .insert({
          title: title.trim() || `Meeting · ${today()}`,
          source,
          audio_url: audioUrl,
          transcript: named(),
          speaker_map: speakerMap,
          summary: result.summary,
          status: 'confirmed',
        })
        .select()
        .single();
      if (mErr) throw mErr;

      const keptDecisions = result.decisions.filter(d => d.keep && d.text?.trim());
      if (keptDecisions.length) {
        const { data: saved, error: e } = await supabase
          .from('decisions')
          .insert(keptDecisions.map(d => ({
            meeting_id: m.id, text: d.text, made_by: d.made_by || null, confirmed: true,
          })))
          .select('id');
        if (e) throw e;
        for (let i = 0; i < keptDecisions.length; i++) {
          const d = keptDecisions[i];
          if (d.conflict && d.supersede) {
            await supabase
              .from('decisions')
              .update({ status: 'superseded', superseded_by: saved[i].id })
              .eq('id', d.conflict.past_id);
          }
        }
      }

      const actions = result.actions
        .filter(a => a.keep && a.task?.trim())
        .map(a => ({
          meeting_id: m.id, task: a.task, owner: a.owner || null,
          deadline: a.deadline || null, confirmed: true,
        }));
      let warning = '';
      if (actions.length) {
        const { data: savedActions, error: e } = await supabase
          .from('action_items')
          .insert(actions)
          .select('id, task, owner, deadline');
        if (e) throw e;

        setStatus('Creating Trello cards');
        try {
          const { cards } = await post('/api/trello', { items: savedActions, meetingTitle: m.title });
          await Promise.all(
            cards
              .filter(c => c.url)
              .map(c => supabase.from('action_items').update({ trello_url: c.url }).eq('id', c.id))
          );
          const failed = cards.filter(c => c.error).length;
          if (failed) warning = `${failed} task(s) saved but not sent to Trello.`;
        } catch (err) {
          warning = `Saved, but Trello sync failed: ${err.message}`;
        }
      }

      reset();
      await loadBoard();
      if (warning) setError(warning);
    } catch (e) { fail(e, 'review'); }
  }

  async function cycle(t) {
    const next = { todo: 'doing', doing: 'done', done: 'todo' }[t.status];
    await supabase.from('action_items').update({ status: next }).eq('id', t.id);
    loadBoard();
  }

  const cols = { todo: 'To do', doing: 'In progress', done: 'Done' };

  return (
    <div className="app">
      <header>
        <span className="mono">Meeting → Execution</span>
        <h1>Nothing said in the room gets lost.</h1>
      </header>

      <section className="panel">
        {stage === 'input' && (
          <>
            <input
              type="text" className="title-input" placeholder="Meeting title (optional)"
              value={title} onChange={e => setTitle(e.target.value)}
            />
            <div className="tabs">
              {[['record', 'Record'], ['upload', 'Upload'], ['paste', 'Paste / dictate']].map(([k, l]) => (
                <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>

            {tab === 'record' && <Recorder onDone={b => handleAudio(b, 'record')} />}

            {tab === 'upload' && (
              <label className="drop">
                <input
                  type="file" accept="audio/*" hidden
                  onChange={e => e.target.files[0] && handleAudio(e.target.files[0], 'upload')}
                />
                Tap to choose a recording from your phone or laptop
              </label>
            )}

            {tab === 'paste' && (
              <>
                <textarea
                  placeholder={'Paste a transcript or dictate it with Wispr Flow.\nTip: start lines with "Name:" to tag who spoke.'}
                  value={pasted} onChange={e => setPasted(e.target.value)}
                />
                <div className="row end">
                  <button className="btn" onClick={handlePaste}>Continue</button>
                </div>
              </>
            )}
          </>
        )}

        {stage === 'working' && (
          <div className="status"><div className="spinner" /><span>{status}…</span></div>
        )}

        {stage === 'speakers' && (
          <>
            <h2>Who said what?</h2>
            <p className="mono">Name each voice so owners come out right</p>
            {Object.keys(speakerMap).map(k => (
              <div className="row speaker" key={k}>
                <span className="badge">{label(k)}</span>
                <input
                  type="text" placeholder="Name" value={speakerMap[k]}
                  onChange={e => setSpeakerMap(m => ({ ...m, [k]: e.target.value }))}
                />
              </div>
            ))}
            <div className="transcript">
              {utterances.map((u, i) => (
                <p key={i}><b>{speakerMap[u.speaker] || label(u.speaker)}</b> {u.text}</p>
              ))}
            </div>
            <div className="row end">
              <button className="btn ghost" onClick={reset}>Start over</button>
              <button className="btn" onClick={extract}>Extract</button>
            </div>
          </>
        )}

        {stage === 'review' && result && (
          <>
            <h2>Review before saving</h2>
            <p className="summary">{result.summary}</p>

            <p className="mono">Decisions</p>
            {result.decisions.length === 0 && <p className="empty">None found</p>}
            {result.decisions.map((d, i) => (
              <div key={i}>
                <div className={`item decision ${d.keep ? '' : 'off'}`}>
                  <input type="checkbox" checked={d.keep}
                    onChange={e => edit('decisions', i, 'keep', e.target.checked)} />
                  <input type="text" value={d.text}
                    onChange={e => edit('decisions', i, 'text', e.target.value)} />
                  <input type="text" className="owner" placeholder="Made by" value={d.made_by || ''}
                    onChange={e => edit('decisions', i, 'made_by', e.target.value)} />
                </div>
                {d.conflict && d.keep && (
                  <div className="conflict">
                    <span className="mono">⚠ Conflicts with an earlier decision</span>
                    <p>
                      <s>{d.conflict.old?.text}</s> · {d.conflict.old?.made_by || 'unknown'}
                      {d.conflict.old?.meetings?.title ? `, ${d.conflict.old.meetings.title}` : ''}
                    </p>
                    <p className="why">{d.conflict.explanation}</p>
                    <div className="row">
                      <button className={`chip ${d.supersede ? 'on' : ''}`}
                        onClick={() => edit('decisions', i, 'supersede', true)}>Replace old decision</button>
                      <button className={`chip ${!d.supersede ? 'on' : ''}`}
                        onClick={() => edit('decisions', i, 'supersede', false)}>Keep both</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <p className="mono">Action items</p>
            {result.actions.length === 0 && <p className="empty">None found</p>}
            {result.actions.map((a, i) => (
              <div className={`item ${a.keep ? '' : 'off'}`} key={i}>
                <input type="checkbox" checked={a.keep}
                  onChange={e => edit('actions', i, 'keep', e.target.checked)} />
                <input type="text" value={a.task}
                  onChange={e => edit('actions', i, 'task', e.target.value)} />
                <input type="text" className="owner" placeholder="Owner" value={a.owner || ''}
                  onChange={e => edit('actions', i, 'owner', e.target.value)} />
                <input type="date" value={a.deadline || ''}
                  onChange={e => edit('actions', i, 'deadline', e.target.value)} />
              </div>
            ))}

            <p className="mono">Nothing is saved or sent to Trello until you confirm</p>
            <div className="row end">
              <button className="btn ghost" onClick={reset}>Discard</button>
              <button className="btn" onClick={confirm}>Confirm & send</button>
            </div>
          </>
        )}

        {error && stage !== 'working' && <p className="error">{error}</p>}
      </section>

      <section className="section">
        <h2>Task board</h2>
        <div className="board">
          {Object.entries(cols).map(([k, l]) => {
            const list = tasks.filter(t => t.status === k);
            return (
              <div className="col" key={k}>
                <p className="mono">{l} · {list.length}</p>
                {list.map(t => <TaskCard key={t.id} t={t} onClick={() => cycle(t)} />)}
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <h2>Decision memory</h2>
        {log.length === 0 && <p className="empty">No decisions yet</p>}
        {log.map(d => (
          <div className={`log ${d.status}`} key={d.id}>
            <span>{d.text}</span>
            <span className="mono">
              {d.made_by || '—'} · {d.meetings?.title}{d.status === 'superseded' ? ' · replaced' : ''}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

function Recorder({ onDone }) {
  const [live, setLive] = useState(false);
  const [secs, setSecs] = useState(0);
  const mr = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const m = new MediaRecorder(stream);
      chunks.current = [];
      m.ondataavailable = e => e.data.size && chunks.current.push(e.data);
      m.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        onDone(new Blob(chunks.current, { type: m.mimeType || 'audio/webm' }));
      };
      m.start(1000); // save in 1-second chunks (needed for iPhone Safari)
      mr.current = m;
      setSecs(0);
      setLive(true);
      timer.current = setInterval(() => setSecs(s => s + 1), 1000);
    } catch {
      alert('Microphone access was blocked. Allow it in your browser settings.');
    }
  }

  function stop() {
    clearInterval(timer.current);
    setLive(false);
    mr.current?.stop();
  }

  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');

  return (
    <div className="rec">
      <button className={`rec-btn ${live ? 'live' : ''}`} onClick={live ? stop : start}
        aria-label={live ? 'Stop recording' : 'Start recording'} />
      <span className="timer">{mm}:{ss}</span>
      <span className="mono">{live ? 'Recording · tap to stop' : 'Tap to start recording'}</span>
    </div>
  );
}

function TaskCard({ t, onClick }) {
  let cls = '';
  if (t.deadline && t.status !== 'done') {
    const days = Math.round((new Date(t.deadline) - new Date(today())) / 86400000);
    cls = days < 0 ? 'overdue' : days <= 2 ? 'soon' : '';
  }
  return (
    <div className="task" onClick={onClick} title="Click to move to the next column">
      <div>{t.task}</div>
      <div className="meta">
        <span className="mono">{t.owner || 'Unassigned'}</span>
        {t.deadline && <span className={`badge ${cls}`}>{t.deadline}</span>}
      </div>
      {t.meetings?.title && <div className="from">{t.meetings.title}</div>}
      {t.trello_url && (
        <a className="trello" href={t.trello_url} target="_blank" rel="noreferrer"
          onClick={e => e.stopPropagation()}>Open in Trello ↗</a>
      )}
    </div>
  );
}