import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { localZone } from '../lib/util';

const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default function Auth({ recovery }) {
  const [mode, setMode] = useState(recovery ? 'reset' : 'signin');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setErr(''); setMsg('');
    if (mode === 'reset') {
      if (form.password.length < 8) return setErr('Use at least 8 characters.');
      setBusy(true);
      const { error } = await supabase.auth.updateUser({ password: form.password });
      setBusy(false);
      if (error) setErr(error.message); else { setMsg('Password updated.'); window.location.hash = ''; }
      return;
    }
    const email = form.email.trim().toLowerCase();
    if (!emailOk(email)) return setErr('Enter a valid email.');
    if (form.password.length < 8) return setErr('Use at least 8 characters for the password.');
    if (mode === 'signup' && !form.name.trim()) return setErr('Tell us your name, as people say it in conversations.');
    setBusy(true);
    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email, password: form.password,
        options: { data: { name: form.name.trim(), timezone: localZone() }, emailRedirectTo: window.location.origin },
      });
      if (error) setErr(error.message);
      else if (!data.session) setMsg('Check your inbox to confirm your email, then sign in.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password: form.password });
      if (error) setErr(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message);
    }
    setBusy(false);
  }

  async function forgot() {
    const email = form.email.trim().toLowerCase();
    if (!emailOk(email)) return setErr('Enter your email first.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) setErr(error.message); else setMsg('We sent you a link to reset your password.');
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand"><span className="dot" />Minutes</div>
        <h1 className="auth-title">Your conversations, <em>minuted.</em></h1>
        <p className="lede">Record a meeting, a networking chat or a quick call. Minutes writes the summary, catches your follow-ups and reminds you, with a calendar built in.</p>

        {mode !== 'reset' && (
          <div className="seg wide">
            <button className={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')}>Sign in</button>
            <button className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>Create account</button>
          </div>
        )}
        <form onSubmit={submit} className="auth-form">
          {mode === 'signup' && (
            <input type="text" placeholder="Your name, like Devesh" autoComplete="name" value={form.name} onChange={e => set('name', e.target.value)} />
          )}
          {mode !== 'reset' && (
            <input type="email" placeholder="name@company.com" autoComplete="email" value={form.email} onChange={e => set('email', e.target.value)} />
          )}
          <input type="password" placeholder={mode === 'reset' ? 'New password' : 'Password'} value={form.password}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} onChange={e => set('password', e.target.value)} />
          <button className="btn" disabled={busy}>
            {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Set new password' : 'Sign in'}
          </button>
        </form>
        {mode === 'signin' && <button className="link" onClick={forgot}>Forgot your password?</button>}
        {err && <p className="error">{err}</p>}
        {msg && <p className="notice">{msg}</p>}
      </div>
    </div>
  );
}
