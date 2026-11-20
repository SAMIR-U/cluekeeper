
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/cluekeeperDB";
import {
  DEMO_RALLY,
  DEMO_TEAM,
  loadDemoContent,
  clearDemoContent,
} from "../services/offlineRally";
import "./OfflineRallyTest.css";

export default function OfflineRallyTest() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const items = useLiveQuery(
    async () => {
      const results = await db.rallyContent
        .where("rallyId")
        .equals(DEMO_RALLY)
        .filter(item => item.teamId === DEMO_TEAM)
        .toArray();

      return results.sort(
        (a, b) => a.unlockedAt - b.unlockedAt
      );
    },
    [],
    []
  );

  async function execute(action, successMessage) {
    setBusy(true);
    setMessage("");
    setError("");

    try {
      await action();
      setMessage(successMessage);
    } catch (err) {
      setError(err.message || "Ocurrió un error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="offline-rally">
      <h2>HU-20 · Pistas y retos offline</h2>

      <p>
        Esta sección utiliza contenido ficticio para
        comprobar la persistencia local del rally.
      </p>

      <div className="offline-actions">
        <button
          disabled={busy}
          onClick={() => execute(
            loadDemoContent,
            "Pista y reto guardados en IndexedDB."
          )}
        >
          Preparar rally de prueba
        </button>

        <button
          disabled={busy}
          onClick={() => execute(
            clearDemoContent,
            "Contenido de demostración eliminado."
          )}
        >
          Limpiar demo
        </button>
      </div>

      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}

      <h3>Contenido disponible ({items.length})</h3>

      {items.length === 0 && (
        <p>
          No hay pistas ni retos almacenados.
        </p>
      )}

      {items.map(item => (
        <article className="offline-item" key={item.key}>
          <small>
            {item.kind === "CLUE" ? "PISTA" : "RETO"}
          </small>

          <h4>{item.content.title}</h4>

          {item.kind === "CLUE" ? (
            <p>{item.content.text}</p>
          ) : (
            <>
              <p>{item.content.description}</p>
              <p><strong>Instrucción:</strong> {
                item.content.instruction
              }</p>
              <p>
                Evidencia requerida: {
                  item.content.evidenceType
                }
              </p>
            </>
          )}

          <small>
            Checkpoint: {item.checkpointId}
          </small>
          <p>Disponible localmente</p>
        </article>
      ))}
    </section>
  );
}
