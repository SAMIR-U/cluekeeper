import { api } from './api';

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator &&
    'PushManager' in window && 'Notification' in window;
}

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

function keyToBytes(value) {
  const padded = value + '='.repeat((4 - value.length % 4) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function getRegistrationAndSubscription() {
  const registration = await navigator.serviceWorker.ready;
  return { registration, subscription: await registration.pushManager.getSubscription() };
}

export async function getPushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'disabled';
  const { subscription } = await getRegistrationAndSubscription();
  return subscription ? 'enabled' : 'disabled';
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Este navegador no admite notificaciones push.');
  // Pide permiso mientras sigue vigente el gesto del usuario; primero hacer una petición
  // de red puede hacer que Safari/Chrome ignore el permiso por falta de interacción.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permite las notificaciones desde los ajustes del navegador.');
  const { enabled, publicKey } = await api('/push/public-key');
  if (!enabled || !publicKey) throw new Error('Las notificaciones no están configuradas en el servidor.');

  const { registration, subscription: current } = await getRegistrationAndSubscription();
  const key = keyToBytes(publicKey);
  let subscription = current;
  if (subscription?.options?.applicationServerKey) {
    const existing = new Uint8Array(subscription.options.applicationServerKey);
    if (existing.length !== key.length || !existing.every((byte, index) => byte === key[index])) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/push/subscribe', { method: 'POST', body: subscription.toJSON() });
  return subscription;
}

export async function disablePush() {
  if (!pushSupported()) return;
  const { subscription } = await getRegistrationAndSubscription();
  if (!subscription) return;
  try { await api('/push/subscribe', { method: 'DELETE', body: { endpoint: subscription.endpoint } }); }
  finally { await subscription.unsubscribe(); }
}

export async function syncPushSubscription() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const { subscription } = await getRegistrationAndSubscription();
  if (subscription) await api('/push/subscribe', { method: 'POST', body: subscription.toJSON() });
}
