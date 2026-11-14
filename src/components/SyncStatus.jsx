
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/cluekeeperDB";
import {
  isSyncConfigured,
  recoverInterruptedSync,
  syncEvidences,
} from "../services/evidenceSync";

export default function SyncStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  const evidences = useLiveQuery(
    () => db.evidences.toArray(),
    [],
    []
  );

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
      setMessage(
        `Sincronización terminada. ${result.sent} enviadas.`
      );
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    let active = true;

    function onOnline() {
      setOnline(true);
      if (isSyncConfigured()) {
        syncEvidences().catch(console.error);
      }
    }

    function onOffline() {
      setOnline(false);
    }

    async function initialize() {
      try {
        await recoverInterruptedSync();
        if (active && navigator.onLine &&
            isSyncConfigured()) {
          await syncEvidences();
        }
      } catch (error) {
        console.error("Error de recuperación:", error);
      }
    }

    initialize();

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
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
