import highsLoader from "highs";
import type { MilpModel, MilpSolution, MilpSolver, SolveStatus, SolverOptions } from "./milp.js";

type Loaded = Awaited<ReturnType<typeof highsLoader>>;
let loaded: Promise<Loaded> | undefined;

/** Moteur HiGHS en WebAssembly (fonctionne dans Node et dans le navigateur). */
export class HighsWasmSolver implements MilpSolver {
  /** `locateFile` : où trouver highs.wasm (nécessaire dans un navigateur). */
  constructor(private readonly init: { locateFile?(file: string): string } = {}) {}

  async solve(model: MilpModel, options: SolverOptions = {}): Promise<MilpSolution> {
    if (model.variableCount === 0) {
      return { status: "optimal", timeLimitReached: false, objective: 0, values: [], millis: 0 };
    }
    loaded ??= highsLoader(this.init);
    const highs = await loaded;
    const lp = model.toLP();
    const t0 = performance.now();
    const res = highs.solve(lp, {
      time_limit: options.timeLimitSec ?? 60,
      mip_rel_gap: options.gap ?? 0.01,
    });
    const millis = Math.round(performance.now() - t0);

    const timeLimitReached = res.Status === "Time limit reached";
    const values = new Array<number>(model.variableCount).fill(0);
    let hasSolution = false;
    for (const [name, col] of Object.entries(res.Columns ?? {})) {
      const i = Number(name.slice(1));
      if (name[0] === "v" && Number.isInteger(i) && i < values.length) {
        values[i] = (col as { Primal: number }).Primal;
        hasSolution = true;
      }
    }

    let status: SolveStatus;
    if (res.Status === "Optimal") status = "optimal";
    else if (res.Status === "Infeasible") status = "infeasible";
    else if (res.Status === "Unbounded") status = "unbounded";
    else if (timeLimitReached && hasSolution) status = "feasible";
    else status = "error";

    return { status, timeLimitReached, objective: res.ObjectiveValue ?? 0, values, millis };
  }
}
