import { analyzePlanning, type Analysis, type Assignment, type Planning, type Space } from "@planning/core";
import { HighsWasmSolver } from "./highs.js";
import type { MilpSolver, SolveStatus, SolverOptions } from "./milp.js";
import { buildProblem, type ProblemOptions } from "./problem.js";

export interface SolveOptions extends ProblemOptions {
  solver?: MilpSolver;
  solverOptions?: SolverOptions;
}

export interface SolveOutcome {
  status: SolveStatus;
  timeLimitReached: boolean;
  /** Planning de la période : les affectations calculées (les verrouillées restent verrouillées) et les interdictions. */
  planning: Planning;
  /** Couverture des besoins, charge de chacun, règles violées. */
  analysis: Analysis;
  warnings: string[];
  stats: { variables: number; rows: number; millis: number; objective: number };
}

/** Calcule le planning d'une période pour un espace. Ne répond jamais « impossible » : les places qu'on ne peut pas pourvoir restent vides et sont signalées. */
export async function solvePeriod(space: Space, options: SolveOptions): Promise<SolveOutcome> {
  const problem = buildProblem(space, options);
  const solver = options.solver ?? new HighsWasmSolver();
  const solution = await solver.solve(problem.model, options.solverOptions);

  const existing = space.plannings.find((p) => p.periodId === options.periodId);
  const lockedKeys = new Set((existing?.assignments ?? []).filter((a) => a.locked).map((a) => `${a.needId}|${a.date}|${a.resourceId}`));

  const usable = solution.status === "optimal" || solution.status === "feasible";
  const assignments: Assignment[] = [];
  if (usable) {
    for (const av of problem.vars) {
      if ((solution.values[av.v] ?? 0) < 0.5) continue;
      assignments.push({
        needId: av.occ.needId,
        date: av.occ.date,
        resourceId: av.resourceId,
        locked: lockedKeys.has(`${av.occ.needId}|${av.occ.date}|${av.resourceId}`),
      });
    }
  }
  const warnings = [...problem.warnings];
  if (!usable) {
    warnings.push(
      solution.status === "infeasible"
        ? "Les affectations verrouillées sont incompatibles entre elles ou avec les règles (repos, plafonds) : aucun planning n'a été produit. Libérez des verrous."
        : "Le calcul n'a pas abouti : aucun planning n'a été produit.",
    );
  }

  const planning: Planning = {
    periodId: options.periodId,
    // si le calcul échoue, on garde le planning existant plutôt que de l'effacer
    assignments: usable ? assignments : (existing?.assignments ?? []),
    forbidden: existing?.forbidden ?? [],
  };
  return {
    status: solution.status,
    timeLimitReached: solution.timeLimitReached,
    planning,
    analysis: analyzePlanning(space, options.periodId, planning),
    warnings,
    stats: { variables: problem.model.variableCount, rows: problem.model.rows.length, millis: solution.millis, objective: solution.objective },
  };
}
