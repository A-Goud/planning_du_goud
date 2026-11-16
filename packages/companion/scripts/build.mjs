// Construit dist/ : companion.mjs, solve-worker.mjs et le moteur HiGHS (WebAssembly), prêts à être copiés.
import { rolldown } from "rolldown";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const [input, file] of [["src/cli.ts", "companion.mjs"]]) {
  const bundle = await rolldown({ input: join(root, input), platform: "node", external: ["highs"] });
  await bundle.write({ dir: dist, format: "esm", entryFileNames: file });
}

// HiGHS reste à côté, dans dist/node_modules/highs (il charge son fichier .wasm depuis son dossier).
let highsDir = null;
for (let dir = root; dirname(dir) !== dir && !highsDir; dir = dirname(dir)) {
  const candidate = join(dir, "node_modules", "highs");
  if (existsSync(join(candidate, "package.json"))) highsDir = candidate;
}
if (!highsDir) throw new Error("Le paquet highs est introuvable (npm install ?).");
await cp(highsDir, join(dist, "node_modules", "highs"), { recursive: true });
console.log("Compagnon construit dans", dist);

// Archive servie par le site : planning-compagnon.zip (dossier « compagnon » à décompresser n'importe où).
import { zipDirectory } from "./zip.mjs";
const publicDir = join(root, "..", "app", "public");
await mkdir(publicDir, { recursive: true });
zipDirectory(dist, join(publicDir, "compagnon.zip"), "compagnon/");
console.log("Archive écrite dans", join(publicDir, "compagnon.zip"));
