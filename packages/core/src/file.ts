import { spaceSchema, type Space } from "./model.js";

/** Identifiant de format et version courante des fichiers. */
export const FILE_FORMAT = "planning-du-goud";
export const CURRENT_VERSION = 1;

export interface PlanningFile {
  format: typeof FILE_FORMAT;
  version: number;
  exportedAt: string;
  space: Space;
}

export type ImportResult =
  | { ok: true; space: Space; version: number }
  | { ok: false; errors: string[] };

/**
 * Migrations : `migrations[n]` transforme un fichier de version n en version n+1.
 * Vide tant qu'il n'existe qu'une version.
 */
const migrations: Record<number, (file: Record<string, unknown>) => Record<string, unknown>> = {};

export function exportSpace(space: Space, now: Date = new Date()): string {
  const checked = spaceSchema.parse(space);
  const file: PlanningFile = {
    format: FILE_FORMAT,
    version: CURRENT_VERSION,
    exportedAt: now.toISOString(),
    space: checked,
  };
  return JSON.stringify(file, null, 2);
}

/** Lit et valide un fichier. Ne lève jamais d'exception : renvoie des messages lisibles. */
export function importSpace(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["Le fichier n'est pas lisible : ce n'est pas du JSON valide (fichier abîmé ou incomplet ?)."] };
  }

  if (typeof raw !== "object" || raw === null || (raw as Record<string, unknown>).format !== FILE_FORMAT) {
    return { ok: false, errors: ["Ce fichier n'est pas un fichier du Planning d'Alix."] };
  }
  let file = raw as Record<string, unknown>;

  const version = file.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, errors: ["Le fichier n'indique pas de numéro de version valide."] };
  }
  if (version > CURRENT_VERSION) {
    return {
      ok: false,
      errors: [`Ce fichier a été créé par une version plus récente (${version}) que celle de l'application (${CURRENT_VERSION}). Mettez l'application à jour.`],
    };
  }
  for (let v = version; v < CURRENT_VERSION; v++) {
    const migrate = migrations[v];
    if (!migrate) return { ok: false, errors: [`Aucune migration disponible depuis la version ${v}.`] };
    file = migrate(file);
  }

  const parsed = spaceSchema.safeParse(file.space);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => {
      const where = i.path.length ? `${i.path.join(".")} : ` : "";
      return `${where}${i.message}`;
    });
    return { ok: false, errors };
  }
  return { ok: true, space: parsed.data, version };
}
