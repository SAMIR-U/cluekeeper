import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { disablePush, enablePush, getPushState, isIos, isStandalone, syncPushSubscription } from '../services/push';

export default function PushToggle() {
  const [state, setState] = useState('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try { await syncPushSubscription(); } catch { /* Retry on the next app open. */ }
      const next = await getPushState().catch(() => 'unsupported');
      if (active) setState(next);
    })();
    return () => { active = false; };
  }, []);

  if (state === 'loading') return null;
  if (state === 'unsupported') {
    if (isIos() && !isStandalone()) return <p className="muted-text push-hint">En iPhone, instala ClueKeeper desde Compartir → Añadir a pantalla de inicio para activar los avisos.</p>;
    return null;
  }
  if (state === 'blocked') return <p className="muted-text push-hint"><BellOff size={15}/> Los avisos están bloqueados en los ajustes del navegador.</p>;

  async function toggle() {
    setBusy(true);
    setError('');
    try {
      if (state === 'enabled') await disablePush();
      else await enablePush();
      setState(await getPushState());
    } catch (cause) {
      setError(cause.message || 'No fue posible cambiar la configuración de avisos.');
      setState(await getPushState().catch(() => 'disabled'));
    } finally { setBusy(false); }
  }

  return <div className="push-toggle">
    <button type="button" className="button button-soft" onClick={toggle} disabled={busy} aria-pressed={state === 'enabled'}>
      {state === 'enabled' ? <BellOff size={16}/> : <Bell size={16}/>}
      {busy ? 'Un momento…' : state === 'enabled' ? 'Desactivar avisos' : 'Activar avisos de pistas y tiempo'}
    </button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
