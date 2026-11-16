import { getAsset, isSea } from "node:sea";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Vrai quand le programme tourne comme exécutable autonome (compagnon.exe). */
export const standalone = isSea();

/** Commande qui relance ce même programme (utilisée pour calculer dans un processus à part). */
export function selfCommand(): { command: string; args: string[] } {
  return standalone ? { command: process.execPath, args: [] } : { command: process.execPath, args: [process.argv[1]!] };
}

let wasmPath: string | undefined;

/**
 * Où trouver highs.wasm. Dans l'exécutable autonome, le fichier est embarqué : on l'écrit une fois
 * dans le dossier temporaire. Sinon HiGHS le trouve à côté de lui (dossier node_modules).
 */
export function wasmLocator(): ((file: string) => string) | undefined {
  if (!standalone) return undefined;
  return (file: string) => {
    if (!file.endsWith(".wasm")) return file;
    if (!wasmPath) {
      const dir = join(tmpdir(), "planning-compagnon");
      mkdirSync(dir, { recursive: true });
      wasmPath = join(dir, `highs-${process.pid}.wasm`);
      writeFileSync(wasmPath, Buffer.from(getAsset("highs.wasm")));
    }
    return wasmPath;
  };
}
