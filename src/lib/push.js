// Real push reminders: this device subscribes once, then the server can reach it even when the app is closed.
import { post } from './util';

const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { await navigator.serviceWorker.register('/sw.js'); return await navigator.serviceWorker.ready; } catch { return null; }
}

// 'on' | 'off' | 'blocked' | 'unsupported' | 'install-first'
export async function pushState() {
  if (!pushSupported()) return isIOS() && !isInstalled() ? 'install-first' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await registerSW();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush() {
  if (!pushSupported()) throw new Error(isIOS() && !isInstalled()
    ? 'On iPhone, add Minutes to your Home Screen first (Share → Add to Home Screen), then turn reminders on from there.'
    : 'This browser can’t show reminders. Try Chrome, Edge or Safari.');
  if (!KEY) throw new Error('Reminders aren’t set up on the server yet (missing VAPID key).');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them for this site in your browser settings.');
  const reg = await registerSW();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) });
  const device = /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone' : /android/i.test(navigator.userAgent) ? 'Android' : 'Computer';
  await post('/api/push', { action: 'subscribe', subscription: sub.toJSON(), device });
  return 'on';
}

export async function disablePush() {
  const reg = await registerSW();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await post('/api/push', { action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}

export const testPush = () => post('/api/push', { action: 'test' });
