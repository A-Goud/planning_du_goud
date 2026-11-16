import type { Space } from "./model.js";

/**
 * Retire des plannings tout ce qui référence une ressource, un besoin ou une période qui n'existe plus
 * (par exemple après la suppression d'une personne), et des préférences les besoins supprimés.
 */
export function pruneOrphans(space: Space): Space {
  const resourceIds = new Set(space.resources.map((r) => r.id));
  const needIds = new Set(space.needs.map((n) => n.id));
  const periodIds = new Set(space.periods.map((p) => p.id));
  return {
    ...space,
    resources: space.resources.map((r) => ({
      ...r,
      preferences: {
        ...r.preferences,
        preferNeedIds: r.preferences.preferNeedIds.filter((id) => needIds.has(id)),
        avoidNeedIds: r.preferences.avoidNeedIds.filter((id) => needIds.has(id)),
      },
    })),
    needs: space.needs.map((n) => ({ ...n, periodIds: n.periodIds.filter((id) => periodIds.has(id)) })),
    plannings: space.plannings
      .filter((p) => periodIds.has(p.periodId))
      .map((p) => ({
        ...p,
        assignments: p.assignments.filter((a) => needIds.has(a.needId) && resourceIds.has(a.resourceId)),
        forbidden: p.forbidden.filter((f) => resourceIds.has(f.resourceId) && (f.needId === undefined || needIds.has(f.needId))),
      })),
  };
}
