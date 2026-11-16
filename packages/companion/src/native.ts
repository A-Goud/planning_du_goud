import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MilpModel, MilpSolution, SolveStatus, SolverOptions } from "@planning/solver";
import type { Engine } from "./server.js";

/** Lit le fichier de solution écrit par `highs --solution_file`. */
export function parseHighsSolution(text: string, variableCount: number): Omit<MilpSolution, "millis"> {
  const lines = text.split(/\r?\n/);
  const after = (label: string) => {
    const i = lines.findIndex((l) => l.trim() === label);
    return i >= 0 ? (lines[i + 1] ?? "").trim() : "";
  };
  const modelStatus = after("Model status");
  const values = new Array<number>(variableCount).fill(0);
  let hasSolution = false;
  const c = lines.findIndex((l) => /^# Columns/.test(l));
  if (c >= 0) {
    for (let i = c + 1; i < lines.length && !lines[i]!.startsWith("#"); i++) {
      const [name, value] = lines[i]!.trim().split(/\s+/);
      if (!name || value === undefined || name[0] !== "v") continue;
      const index = Number(name.slice(1));
      if (Number.isInteger(index) && index < variableCount) {
        values[index] = Number(value);
        hasSolution = true;
      }
    }
  }
  const objective = Number(/^Objective\s+(\S+)/m.exec(text)?.[1] ?? 0);
  const timeLimitReached = /time limit/i.test(modelStatus);
  let status: SolveStatus;
  if (/^optimal$/i.test(modelStatus)) status = "optimal";
  else if (/infeasible/i.test(modelStatus)) status = "infeasible";
  else if (/unbounded/i.test(modelStatus)) status = "unbounded";
  else if (timeLimitReached && hasSolution) status = "feasible";
  else status = "error";
  return { status, timeLimitReached, objective: Number.isFinite(objective) ? objective : 0, values };
}

/** Cherche l'exécutable HiGHS : chemin donné, sinon `highs` dans le PATH. Renvoie null s'il est introuvable. */
export function findNativeHighs(explicit?: string): string | null {
  const candidate = explicit ?? "highs";
  const r = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000 });
  return r.error || r.status !== 0 ? null : candidate;
}

/** HiGHS natif : écrit le modèle au format LP, lance l'exécutable, relit la solution. */
export function nativeEngine(binary: string): Engine {
  return {
    name: "native",
    async solve(model: MilpModel, options: SolverOptions, signal: AbortSignal): Promise<MilpSolution> {
      const dir = await mkdtemp(join(tmpdir(), "planning-"));
      try {
        const lp = join(dir, "model.lp");
        const sol = join(dir, "solution.txt");
        const opt = join(dir, "options.txt");
        await writeFile(lp, model.toLP());
        // HiGHS 1.16 : le gap et le temps passent par un fichier d'options (la ligne de commande les refuse)
        await writeFile(opt, `time_limit = ${options.timeLimitSec ?? 60}
mip_rel_gap = ${options.gap ?? 0.01}
`);
        const t0 = Date.now();
        await new Promise<void>((resolve, reject) => {
          const child = spawn(binary, ["--model_file", lp, "--options_file", opt, "--solution_file", sol], { stdio: "ignore", signal, windowsHide: true, cwd: dir });
          child.on("error", reject);
          child.on("exit", () => resolve());
        });
        const text = await readFile(sol, "utf8").catch(() => "");
        return { ...parseHighsSolution(text, model.variableCount), millis: Date.now() - t0 };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
