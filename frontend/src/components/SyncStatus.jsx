
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/cluekeeperDB";
import {
  isSyncConfigured,
  recoverInterruptedSync,
  syncEvidences,
} from "../services/evidenceSync";
import { recoverInterruptedActions, syncPlayActions } from "../services/playSync";

export default function SyncStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  const evidences = useLiveQuery(
    () => db.evidences.toArray(),
    [],
    []
  );
  const actions = useLiveQuery(() => db.playActions.toArray(), [], []);

  const counts = {
    PENDING: 0,
    SENDING: 0,
    SENT: 0,
    FAILED: 0,
  };

  for (const evidence of evidences) {
    if (counts[evidence.status] !== undefined) {
      counts[evidence.status]++;
    }
  }

  async function handleSync() {
    if (!isSyncConfigured() || syncing) return;

    setSyncing(true);
    setMessage("");

    try {
      const result = await syncEvidences();
      const actions = await syncPlayActions();
      setMessage(
        `Sincronización terminada. ${result.sent} evidencias y ${actions.sent} acciones enviadas.`
      );
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    let active = true;

    function refreshConnectionStatus() {
      if (!active) return;

      const connected = navigator.onLine;
      setOnline(connected);

      return connected;
    }

    function onOnline() {
      if (refreshConnectionStatus() && isSyncConfigured()) {
        syncEvidences().then(syncPlayActions).catch(console.error);
      }
    }

    function onOffline() {
      refreshConnectionStatus();
    }

    async function initialize() {
      try {
        await recoverInterruptedSync();
        await recoverInterruptedActions();

        if (active &&
            refreshConnectionStatus() &&
            isSyncConfigured()) {
          await syncEvidences();
          await syncPlayActions();
        }
      } catch (error) {
        console.error("Error de recuperación:", error);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshConnectionStatus();
        if (navigator.onLine && isSyncConfigured()) syncEvidences().then(syncPlayActions).catch(console.error);
      }
    }

    function onFocus() {
      if (refreshConnectionStatus() && isSyncConfigured()) syncEvidences().then(syncPlayActions).catch(console.error);
    }

    initialize();

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    document.addEventListener(
      "visibilitychange",
      onVisibilityChange
    );

    return () => {
      active = false;

      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(
        "focus",
        onFocus
      );
      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
    };
  }, []);

  return (
    <section className="sync-status">
      <h2>Sincronización de evidencias</h2>

      <p>
        Conexión del navegador:
        <strong>{online ? " Disponible" : " Sin conexión"}</strong>
      </p>

      <div className="sync-counts">
        <p>Pendientes: {counts.PENDING}</p>
        <p>Enviando: {counts.SENDING}</p>
        <p>Enviadas: {counts.SENT}</p>
        <p>Con error: {counts.FAILED}</p>
      </div>
      <p>Acciones de ruta pendientes: {actions.filter(item => item.status === "PENDING" || item.status === "SENDING").length} · con error: {actions.filter(item => item.status === "FAILED").length}</p>

      {!isSyncConfigured() && (
        <p role="status">
          El backend todavía no está configurado.
          Tus evidencias permanecen guardadas localmente.
        </p>
      )}

      <button
        onClick={handleSync}
        disabled={
          !online ||
          !isSyncConfigured() ||
          syncing
        }
      >
        {syncing ? "Sincronizando..." : "Sincronizar ahora"}
      </button>

      {message && <p role="status">{message}</p>}
    </section>
  );
}
