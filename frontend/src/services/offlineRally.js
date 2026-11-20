
import { db } from "../db/cluekeeperDB";

// Identificadores provisionales de la demostración
export const DEMO_RALLY = "rally-demo";
export const DEMO_TEAM = "team-demo";

function contentKey(rallyId, teamId, contentId) {
  return JSON.stringify([rallyId, teamId, contentId]);
}

// Solo debe llamarse con contenido autorizado
// por el backend o con datos de demostración.
export async function saveUnlockedContent({
  rallyId,
  teamId,
  contentId,
  checkpointId,
  kind,
  content,
}) {
  if (!rallyId || !teamId || !contentId ||
      !checkpointId ||
      !["CLUE", "CHALLENGE"].includes(kind) ||
      !content || typeof content !== "object") {
    throw new Error("Contenido del rally inválido");
  }

  const key = contentKey(rallyId, teamId, contentId);

  const existing = await db.rallyContent.get(key);

  const item = {
    key,
    rallyId,
    teamId,
    contentId,
    checkpointId,
    kind,
    content,
    unlockedAt: existing?.unlockedAt ?? Date.now(),
    updatedAt: Date.now(),
  };

  await db.rallyContent.put(item);
  return item;
}

export async function getOfflineContent(rallyId, teamId) {
  const items = await db.rallyContent
    .where("rallyId")
    .equals(rallyId)
    .filter(item => item.teamId === teamId)
    .toArray();

  return items.sort((a, b) =>
    a.unlockedAt - b.unlockedAt
  );
}

// Datos exclusivamente para probar la funcionalidad offline.
// No son checkpoints reales de ClueKeeper.
export async function loadDemoContent() {
  await saveUnlockedContent({
    rallyId: DEMO_RALLY,
    teamId: DEMO_TEAM,
    contentId: "clue-1",
    checkpointId: "checkpoint-1",
    kind: "CLUE",
    content: {
      title: "Primera pista",
      text:
        "Busca un lugar donde las personas se reúnen " +
        "para descansar y observar su entorno.",
    },
  });

  await saveUnlockedContent({
    rallyId: DEMO_RALLY,
    teamId: DEMO_TEAM,
    contentId: "challenge-1",
    checkpointId: "checkpoint-1",
    kind: "CHALLENGE",
    content: {
      title: "Reto de observación",
      description:
        "Observa cuidadosamente los elementos " +
        "que se encuentran a tu alrededor.",
      instruction:
        "Toma una fotografía de un objeto que " +
        "consideres representativo del lugar.",
      evidenceType: "PHOTO",
    },
  });
}

export async function clearDemoContent() {
  const items = await getOfflineContent(
    DEMO_RALLY,
    DEMO_TEAM
  );

  await db.rallyContent.bulkDelete(
    items.map(item => item.key)
  );
}
