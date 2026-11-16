import { exportSpace, importSpace, spaceSchema, type Space } from "@planning/core";

const DB = "planning-du-goud";
const STORE = "kv";
const KEY = "space";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Sauvegarde automatique dans le navigateur. Les erreurs sont ignorées : le fichier reste la référence. */
export async function saveLocal(space: Space): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(exportSpace(space), KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* stockage indisponible (navigation privée, etc.) */
  }
}

export async function loadLocal(): Promise<Space | null> {
  try {
    const db = await open();
    const text = await new Promise<string | undefined>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as string | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!text) return null;
    const result = importSpace(text);
    return result.ok ? result.space : null;
  } catch {
    return null;
  }
}

export function downloadSpace(space: Space): void {
  const blob = new Blob([exportSpace(space)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = space.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "espace";
  a.href = url;
  a.download = `${safe}.planning.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function emptySpace(name = "Nouvel espace"): Space {
  return spaceSchema.parse({ id: "espace", name });
}
