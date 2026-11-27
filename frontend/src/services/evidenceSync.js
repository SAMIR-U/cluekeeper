
import { db } from "../db/cluekeeperDB";
import { API_BASE, apiUrl, connectionError, getToken } from "./api";

// Evita dos sincronizaciones simultáneas en la misma pestaña
let activeSync = null;

export function isSyncConfigured() {
  return Boolean(API_BASE);
}

async function uploadEvidence(evidence) {
  if (!API_BASE) {
    throw new Error("Backend de evidencias no configurado");
  }

  const form = new FormData();

  form.append("evidenceId", evidence.id);
  form.append("checkpointId", evidence.checkpointId);
  form.append("type", evidence.type);
  form.append("capturedAt", String(evidence.createdAt));

  const extension = evidence.type === "PHOTO"
    ? "jpg"
    : evidence.blob.type.includes("mp4")
      ? "m4a"
      : evidence.blob.type.includes("ogg")
        ? "ogg"
        : "webm";

  const filename = `${evidence.id}.${extension}`;

  form.append("file", evidence.blob, filename);

  const token = getToken();
  let response;
  try {
    response = await fetch(apiUrl("/evidences"), {
      method: "POST",
      credentials: "include",
      headers: {
        "Idempotency-Key": evidence.id,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form,
    });
  } catch (error) {
    throw connectionError(error);
  }

  if (!response.ok) {
    let message = `El servidor respondió HTTP ${response.status}`;
    try { message = (await response.json())?.error?.message || message; } catch { /* plain text response */ }
    const error = new Error(message);

    error.status = response.status;
    throw error;
  }

  const result = await response.json();

  // No basta con recibir cualquier respuesta 200
  if (
    result.evidenceId !== evidence.id ||
    result.status !== "RECEIVED"
  ) {
    throw new Error("Confirmación del servidor inválida");
  }

  return result;
}

async function runSync() {
  if (!isSyncConfigured()) {
    return { configured: false, sent: 0 };
  }

  if (!navigator.onLine) {
    return { offline: true, sent: 0 };
  }

  const pending = await db.evidences
    .filter(item =>
      item.status === "PENDING" ||
      item.status === "FAILED"
    )
    .toArray();

  pending.sort((a, b) => a.createdAt - b.createdAt);

  let sent = 0;

  for (const evidence of pending) {
    const current = await db.evidences.get(evidence.id);

    if (!current ||
        !["PENDING", "FAILED"].includes(current.status)) {
      continue;
    }

    await db.evidences.update(evidence.id, {
      status: "SENDING",
      lastError: null,
    });

    try {
      await uploadEvidence(current);

      await db.evidences.update(evidence.id, {
        status: "SENT",
        syncedAt: Date.now(),
        lastError: null,
      });

      sent++;
    } catch (error) {
      const needsAttention = [
        400, 401, 403, 404, 409, 413, 415, 422,
      ].includes(error.status);

      await db.evidences.update(evidence.id, {
        status: needsAttention ? "FAILED" : "PENDING",
        lastError: error.message,
      });

      // Si falla la red, evitamos insistir con los demás
      if (!error.status) break;
    }
  }

  return { configured: true, sent };
}

export function syncEvidences() {
  if (!activeSync) {
    activeSync = runSync().finally(() => {
      activeSync = null;
    });
  }

  return activeSync;
}

// Recuperación tras cerrar la aplicación durante un envío.
// Debe llamarse al iniciar la aplicación.
export async function recoverInterruptedSync() {
  await db.evidences
    .where("status")
    .equals("SENDING")
    .modify({
      status: "PENDING",
      lastError: "Envío interrumpido; requiere reintento",
    });
}
