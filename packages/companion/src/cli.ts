import { createCompanion } from "./server.js";
import { findNativeHighs, nativeEngine } from "./native.js";
import { CHILD_FLAG, runSolveChild, wasmProcessEngine } from "./process-engine.js";

/** Site autorisé quand on double-clique sur le programme sans option. */
const DEFAULT_ORIGIN = "https://planning.potodugoud.fr";

const HELP = `Le planning d'Alix — compagnon de calcul

Usage : compagnon [options]

  --origin <url>   Site autorisé (défaut : ${DEFAULT_ORIGIN}). Répétable.
  --dev            Autorise aussi http://localhost:5173 (développement).
  --port <n>       Port local (défaut 47822).
  --highs <chemin> Exécutable HiGHS natif à utiliser (sinon « highs » du PATH, sinon HiGHS WebAssembly).
  --wasm           Force HiGHS WebAssembly même si un exécutable natif est trouvé.
`;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const values = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []));

/** Les consoles Windows classiques lisent mal l'UTF-8 : sans accents, le texte reste lisible partout. */
const say = (text: string) =>
  process.platform === "win32" ? text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/—/g, "-").replace(/«|»/g, '"') : text;

async function main() {
  if (flag(CHILD_FLAG)) return runSolveChild();
  if (flag("--help") || flag("-h")) {
    console.log(say(HELP));
    return;
  }

  const origins = values("--origin");
  if (origins.length === 0) origins.push(DEFAULT_ORIGIN);
  if (flag("--dev")) origins.push("http://localhost:5173", "http://127.0.0.1:5173");

  const port = Number(values("--port")[0] ?? 47822);
  const native = flag("--wasm") ? null : findNativeHighs(values("--highs")[0]);
  const engine = native ? nativeEngine(native) : wasmProcessEngine();

  createCompanion({ engine, origins })
    // Écoute réservée à cette machine : jamais accessible depuis le réseau.
    .listen(port, "127.0.0.1", () => {
      console.log(say("Le planning d'Alix — compagnon de calcul"));
      console.log(say(`Prêt sur http://127.0.0.1:${port}`));
      console.log(say(`Moteur : ${native ? `HiGHS natif (${native})` : "HiGHS WebAssembly (aucun exécutable natif trouvé)"}`));
      console.log(say(`Sites autorisés : ${origins.join(", ")}`));
      console.log(say("Laissez cette fenêtre ouverte pendant le calcul. Fermez-la (ou Ctrl+C) pour arrêter."));
    })
    .on("error", (e: NodeJS.ErrnoException) => {
      console.error(say(e.code === "EADDRINUSE" ? `Le port ${port} est déjà utilisé (un compagnon tourne-t-il déjà ?).` : e.message));
      process.exit(1);
    });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
