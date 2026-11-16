import { periodOccurrences, type Space } from "@planning/core";
import { isEligible } from "./problem.js";

/** Au-delà, le solveur du navigateur devient lent ou manque de mémoire : le compagnon est recommandé. */
export const COMPANION_RECOMMENDED_ABOVE = 20_000;

/** Nombre d'affectations candidates (variables du calcul), sans construire le modèle. */
export function estimateVariables(space: Space, periodId: string): number {
  const planning = space.plannings.find((p) => p.periodId === periodId);
  let total = 0;
  for (const occ of periodOccurrences(space, periodId)) {
    for (const r of space.resources) if (isEligible(r, occ, planning)) total++;
  }
  return total;
}
