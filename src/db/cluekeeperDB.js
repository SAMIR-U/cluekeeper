
import Dexie from "dexie";

export const db = new Dexie("ClueKeeperDB");

db.version(1).stores({
  evidences: "id, checkpointId, type, status, createdAt",
});

export async function savePhotoEvidence(blob, checkpointId) {
  if (!(blob instanceof Blob) || !blob.size) {
    throw new Error("La fotografía no es válida");
  }

  const evidence = {
    id: crypto.randomUUID(),
    checkpointId,
    type: "PHOTO",
    blob,
    status: "PENDING",
    createdAt: Date.now(),
  };

  await db.evidences.add(evidence);
  return evidence.id;
}

export async function deleteEvidence(id) {
  await db.evidences.delete(id);
}


export async function saveAudioEvidence(blob, checkpointId) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("La grabación no es válida");
  }

  const evidence = {
    id: crypto.randomUUID(),
    checkpointId,
    type: "AUDIO",
    blob,
    status: "PENDING",
    createdAt: Date.now(),
  };

  await db.evidences.add(evidence);

  return evidence.id;
}
