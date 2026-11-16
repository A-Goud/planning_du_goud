// Fabrique compagnon.exe : un seul fichier (Node + programme + HiGHS), sans installation.
// Nécessite d'être lancé avec le Node du système sur lequel l'exécutable tournera (ici Windows).
import { rolldown } from "rolldown";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inject } from "postject";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const work = join(root, ".sea");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// 1. Un seul fichier CommonJS (exigé par les exécutables Node), HiGHS compris
const bundle = await rolldown({ input: join(root, "src/cli.ts"), platform: "node" });
await bundle.write({ dir: work, format: "cjs", entryFileNames: "companion.cjs" });

// 2. Le moteur WebAssembly est embarqué comme ressource
let highsDir = null;
for (let d = root; dirname(d) !== d && !highsDir; d = dirname(d)) {
  if (existsSync(join(d, "node_modules", "highs", "build", "highs.wasm"))) highsDir = join(d, "node_modules", "highs");
}
if (!highsDir) throw new Error("Le paquet highs est introuvable (npm install ?).");

const config = {
  main: join(work, "companion.cjs"),
  output: join(work, "sea.blob"),
  disableExperimentalSEAWarning: true,
  assets: { "highs.wasm": join(highsDir, "build", "highs.wasm") },
};
writeFileSync(join(work, "sea-config.json"), JSON.stringify(config));
execFileSync(process.execPath, ["--experimental-sea-config", join(work, "sea-config.json")], { stdio: "inherit" });

// 3. Copie de Node, puis injection du programme
const exe = join(work, "compagnon.exe");
copyFileSync(process.execPath, exe);
await inject(exe, "NODE_SEA_BLOB", readFileSync(config.output), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
});

const target = join(root, "..", "app", "public", "compagnon.exe");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(exe, target);
console.log("Exécutable écrit dans", target);
