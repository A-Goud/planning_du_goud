import { spawn } from "node:child_process";
import { HighsWasmSolver, MilpModel, type MilpSolution, type SolverOptions } from "@planning/solver";
import { selfCommand, wasmLocator } from "./runtime.js";
import type { Engine } from "./server.js";

export const CHILD_FLAG = "--solve-child";

/**
 * HiGHS WebAssembly dans un processus à part : le serveur reste disponible pendant le calcul,
 * et annuler = tuer le processus (le calcul s'arrête réellement).
 */
export function wasmProcessEngine(): Engine {
  return {
    name: "wasm",
    solve(model: MilpModel, options: SolverOptions, signal: AbortSignal): Promise<MilpSolution> {
      return new Promise((resolve, reject) => {
        const { command, args } = selfCommand();
        const child = spawn(command, [...args, CHILD_FLAG], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
        let out = "";
        let err = "";
        const onAbort = () => {
          child.kill();
          reject(new Error("Calcul annulé."));
        };
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
        child.stdout.on("data", (c) => (out += c));
        child.stderr.on("data", (c) => (err += c));
        child.on("error", (e) => {
          signal.removeEventListener("abort", onAbort);
          reject(e);
        });
        child.on("close", (code) => {
          signal.removeEventListener("abort", onAbort);
          if (signal.aborted) return;
          if (code !== 0) return reject(new Error(`Le calcul a échoué (${code}). ${err.trim().slice(0, 300)}`));
          try {
            resolve(JSON.parse(out) as MilpSolution);
          } catch {
            reject(new Error("Réponse du calcul illisible."));
          }
        });
        child.stdin.on("error", () => {});
        child.stdin.end(JSON.stringify({ model: model.toData(), options }));
      });
    },
  };
}

/** Côté processus enfant : lit le modèle sur l'entrée standard, écrit la solution sur la sortie. */
export async function runSolveChild(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const { model, options } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const locate = wasmLocator();
  const solution = await new HighsWasmSolver(locate ? { locateFile: locate } : {}).solve(MilpModel.fromData(model), options);
  process.stdout.write(JSON.stringify(solution));
}
