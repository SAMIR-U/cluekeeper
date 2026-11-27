import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { disablePush, enablePush, getPushState, isIos, isStandalone, syncPushSubscription, testPush } from '../services/push';

export default function PushToggle() {
  const [state, setState] = useState('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

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
    if (isIos() && !isStandalone()) return <p className="muted-text push-hint">En iPhone, instala ClueKeeper desde Compartir → Añadir a pantalla de inicio y activa los avisos dentro del rally.</p>;
    return null;
  }
  if (state === 'blocked') return <p className="muted-text push-hint"><BellOff size={15}/> Los avisos están bloqueados. Permítelos manualmente en la configuración del navegador.</p>;

  async function toggle() {
    setBusy(true); setError(''); setMessage('');
    try {
      if (state === 'enabled') await disablePush();
      else await enablePush();
      setState(await getPushState());
    } catch (cause) {
      setError(cause.message || 'No fue posible cambiar la configuración de avisos.');
      setState(await getPushState().catch(() => 'disabled'));
    } finally { setBusy(false); }
  }

  async function sendTest() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await testPush();
      if (!result.sent) throw new Error('El servidor no encontró un dispositivo suscrito para este equipo. Desactiva y vuelve a activar los avisos.');
      setMessage('Aviso de prueba enviado al dispositivo.');
    } catch (cause) { setError(cause.message || 'No fue posible enviar el aviso de prueba.'); }
    finally { setBusy(false); }
  }

  return <div className="push-toggle">
    <span className="push-hint">Los avisos se activan después de entrar al rally. El navegador pide permiso al tocar el botón; no puede pedirlo automáticamente durante la instalación.</span>
    <div className="push-actions">
      <button type="button" className="button button-soft" onClick={toggle} disabled={busy} aria-pressed={state === 'enabled'}>
        {state === 'enabled' ? <BellOff size={16}/> : <Bell size={16}/>}
        {busy ? 'Un momento…' : state === 'enabled' ? 'Desactivar avisos' : 'Activar avisos de pistas y tiempo'}
      </button>
      {state === 'enabled' && <button type="button" className="button button-soft" onClick={sendTest} disabled={busy}>Enviar aviso de prueba</button>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="push-success" role="status">{message}</p>}
  </div>;
}
