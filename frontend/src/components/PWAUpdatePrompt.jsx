
import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh && !offlineReady) return null

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 20,
        left: 20,
        right: 20,
        maxWidth: 400,
        margin: '0 auto',
        padding: 16,
        background: '#14213d',
        color: 'white',
        borderRadius: 12,
        zIndex: 9999,
        boxShadow: '0 4px 16px #0004',
      }}
    >
      <p>
        {needRefresh
          ? 'Hay una nueva versión de ClueKeeper disponible.'
          : 'ClueKeeper está lista para funcionar offline.'}
      </p>

      {needRefresh && (
        <button onClick={() => updateServiceWorker(true)}>
          Actualizar ahora
        </button>
      )}

      <button
        onClick={() => {
          setNeedRefresh(false)
          setOfflineReady(false)
        }}
      >
        Cerrar
      </button>
    </div>
  )
}
