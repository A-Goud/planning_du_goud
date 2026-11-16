import {
  analyzePlanning,
  formatDate,
  formatHours,
  periodOccurrences,
  whyNot,
  type Analysis,
  type Space,
  type Why,
  type WhyKind,
} from "@planning/core";
import { solvePeriod, type SolveOptions, type SolveOutcome } from "./solve.js";

/** Une modification des données qui pourrait débloquer des places vides. L'utilisateur décide de l'appliquer ou non. */
export type Patch =
  | { type: "relax"; restDelta?: number; daysDelta?: number; weekDelta?: number }
  | { type: "addSkill"; resourceId: string; skill: string }
  | { type: "clearAvailability"; resourceId: string }
  | { type: "unlock" };

export interface Suggestion {
  description: string;
  patch: Patch;
  /** Places encore vides pour ce besoin si la modification est appliquée. */
  missingAfter: number;
  /** Places encore vides, tous besoins confondus. */
  totalMissingAfter: number;
  /** Besoins qui perdent des places pourvues si la modification est appliquée. */
  collateral: { needId: string; label: string; lost: number }[];
}

export interface NeedDiagnosis {
  needId: string;
  label: string;
  /** Jours où des places restent vides. */
  missing: { date: string; missing: number }[];
  totalMissing: number;
  /** Raisons constatées, en français. */
  causes: string[];
  /** Modifications testées qui réduiraient les places vides, les meilleures d'abord. */
  suggestions: Suggestion[];
}

export interface DiagnoseOptions extends SolveOptions {
  /** Nombre maximal de besoins analysés (les plus prioritaires d'abord). */
  maxNeeds?: number;
  /** Temps maximal de chaque calcul d'essai, en secondes. */
  relaxTimeLimitSec?: number;
}

export interface DiagnoseResult {
  diagnoses: NeedDiagnosis[];
  /** Besoins non pourvus qui n'ont pas été analysés (limite atteinte). */
  skipped: string[];
  /** Un nouveau calcul avec les données actuelles : base de comparaison des suggestions. */
  baselineMissing: number;
}

/** Applique une modification à l'espace (sans la valider : l'appelant le fait). */
export function applyPatch(space: Space, periodId: string, patch: Patch): Space {
  switch (patch.type) {
    case "relax": {
      const { restDelta = 0, daysDelta = 0, weekDelta = 0 } = patch;
      return {
        ...space,
        rules: {
          ...space.rules,
          minRestUnits: Math.max(0, space.rules.minRestUnits - restDelta),
          maxConsecutiveDays: Math.min(14, space.rules.maxConsecutiveDays + daysDelta),
          maxWeekUnits: space.rules.maxWeekUnits + weekDelta,
        },
        resources: space.resources.map((r) => {
          const c = r.contract;
          return {
            ...r,
            contract: {
              ...c,
              ...(c.minRestUnits !== undefined ? { minRestUnits: Math.max(0, c.minRestUnits - restDelta) } : {}),
              ...(c.maxConsecutiveDays !== undefined ? { maxConsecutiveDays: Math.min(14, c.maxConsecutiveDays + daysDelta) } : {}),
              ...(c.maxWeekUnits !== undefined ? { maxWeekUnits: c.maxWeekUnits + weekDelta } : {}),
            },
          };
        }),
      };
    }
    case "addSkill":
      return { ...space, resources: space.resources.map((r) => (r.id === patch.resourceId && !r.skills.includes(patch.skill) ? { ...r, skills: [...r.skills, patch.skill] } : r)) };
    case "clearAvailability":
      return { ...space, resources: space.resources.map((r) => (r.id === patch.resourceId ? { ...r, weekly: [] } : r)) };
    case "unlock":
      return {
        ...space,
        plannings: space.plannings.map((p) =>
          p.periodId === periodId ? { ...p, forbidden: [], assignments: p.assignments.map((a) => ({ ...a, locked: false })) } : p,
        ),
      };
  }
}

const missingOf = (analysis: Analysis, needId: string) => analysis.coverage.filter((c) => c.needId === needId).reduce((n, c) => n + c.missing, 0);

/** Raisons constatées sans calcul, sur la première vacation incomplète du besoin. */
function explain(space: Space, periodId: string, needId: string, analysis: Analysis): { causes: string[]; kinds: Map<string, Set<WhyKind>>; skillHolders: string[] } {
  const planning = space.plannings.find((p) => p.periodId === periodId);
  const occurrences = periodOccurrences(space, periodId);
  const byKey = new Map(occurrences.map((o) => [o.key, o]));
  const row = analysis.coverage.find((c) => c.needId === needId && c.missing > 0);
  const occ = row ? byKey.get(row.key) : undefined;
  const causes: string[] = [];
  const kinds = new Map<string, Set<WhyKind>>();
  if (!row || !occ) return { causes, kinds, skillHolders: [] };

  const where = `« ${occ.label} » ${formatDate(occ.date)}`;
  const holders = space.resources.filter((r) => occ.skill === undefined || r.skills.includes(occ.skill));
  if (occ.skill !== undefined) {
    if (holders.length === 0) {
      causes.push(`Personne n'a la compétence « ${occ.skill} ».`);
      return { causes, kinds, skillHolders: [] };
    }
    causes.push(`Seuls ${holders.length} personne(s) ont la compétence « ${occ.skill} » : ${holders.map((h) => h.name).join(", ")}.`);
  }
  const needed = occ.required;
  if (holders.length < needed) causes.push(`${where} demande ${needed} personne(s), mais seules ${holders.length} ont la compétence.`);

  const groups: Record<string, string[]> = { unavailable: [], busy: [], limits: [], forbidden: [], free: [] };
  for (const r of holders) {
    const why: Why[] = whyNot(space, byKey, planning, r, occ);
    kinds.set(r.id, new Set(why.map((w) => w.kind)));
    const first = why[0];
    const label = `${r.name}${first ? ` (${first.text})` : ""}`;
    if (why.length === 0) groups.free!.push(r.name);
    else if (why.some((w) => w.kind === "forbidden")) groups.forbidden!.push(label);
    else if (why.some((w) => w.kind === "unavailable")) groups.unavailable!.push(label);
    else if (why.some((w) => w.kind === "overlap" || w.kind === "rest")) groups.busy!.push(label);
    else groups.limits!.push(label);
  }
  if (groups.unavailable!.length) causes.push(`Indisponibles ${formatDate(occ.date)} : ${groups.unavailable!.join(" ; ")}.`);
  if (groups.busy!.length) causes.push(`Déjà pris ou pas assez reposés : ${groups.busy!.join(" ; ")}.`);
  if (groups.limits!.length) causes.push(`Limites atteintes : ${groups.limits!.join(" ; ")}.`);
  if (groups.forbidden!.length) causes.push(`Interdits sur cette vacation : ${groups.forbidden!.join(" ; ")}.`);
  if (groups.free!.length) {
    causes.push(`Sans règle violée, on pourrait y placer : ${groups.free!.join(", ")}. Ces personnes sont employées ailleurs sur des besoins plus prioritaires (ou le planning a été modifié à la main).`);
  }
  return { causes, kinds, skillHolders: holders.map((h) => h.id) };
}

/**
 * Explique pourquoi des places restent vides et teste, une modification à la fois,
 * ce qui les pourvoirait. Rien n'est appliqué : l'utilisateur décide.
 */
export async function diagnosePeriod(space: Space, options: DiagnoseOptions): Promise<DiagnoseResult> {
  const { maxNeeds = 4, relaxTimeLimitSec = 10, ...solveOptions } = options;
  const planning = space.plannings.find((p) => p.periodId === options.periodId);
  const current = analyzePlanning(space, options.periodId);

  const perNeed = new Map<string, { missing: { date: string; missing: number }[]; total: number; priority: number; label: string }>();
  for (const c of current.coverage) {
    if (c.missing === 0) continue;
    const e = perNeed.get(c.needId) ?? { missing: [], total: 0, priority: c.priority, label: c.label };
    e.missing.push({ date: c.date, missing: c.missing });
    e.total += c.missing;
    perNeed.set(c.needId, e);
  }
  const ordered = [...perNeed.entries()].sort((a, b) => b[1].priority - a[1].priority || b[1].total - a[1].total);
  const analysed = ordered.slice(0, maxNeeds);
  const skipped = ordered.slice(maxNeeds).map(([id]) => id);
  if (analysed.length === 0) return { diagnoses: [], skipped, baselineMissing: 0 };

  const trial: SolveOptions = {
    ...solveOptions,
    solverOptions: { ...solveOptions.solverOptions, timeLimitSec: Math.min(solveOptions.solverOptions?.timeLimitSec ?? 10, relaxTimeLimitSec) },
  };
  const baseline: SolveOutcome = await solvePeriod(space, trial);

  const explained = new Map(analysed.map(([id]) => [id, explain(space, options.periodId, id, current)]));
  const allKinds = new Set<WhyKind>();
  for (const e of explained.values()) for (const ks of e.kinds.values()) for (const k of ks) allKinds.add(k);

  // modifications candidates : une clé évite de calculer deux fois la même
  interface Candidate { key: string; description: string; patch: Patch; needs: Set<string> }
  const candidates = new Map<string, Candidate>();
  const add = (key: string, description: string, patch: Patch, needId: string) => {
    const c = candidates.get(key) ?? { key, description, patch, needs: new Set<string>() };
    c.needs.add(needId);
    candidates.set(key, c);
  };
  const needsAll = analysed.map(([id]) => id);
  const hasLocks = (planning?.assignments ?? []).some((a) => a.locked) || (planning?.forbidden.length ?? 0) > 0;
  for (const id of needsAll) {
    if (allKinds.has("rest")) add("rest", "Réduire le repos minimal entre deux vacations de 2 h", { type: "relax", restDelta: 8 }, id);
    if (allKinds.has("consecutive")) add("days", "Autoriser un jour de travail d'affilée de plus", { type: "relax", daysDelta: 1 }, id);
    if (allKinds.has("week")) add("week", `Relever le plafond hebdomadaire de ${formatHours(16)}`, { type: "relax", weekDelta: 16 }, id);
    if (hasLocks) add("unlock", "Libérer les affectations verrouillées et lever les interdictions", { type: "unlock" }, id);
  }
  // compétences : les personnes qui n'ont que ce manque
  const loadOf = new Map(current.loads.map((l) => [l.resourceId, l.totalUnits]));
  const occurrences = periodOccurrences(space, options.periodId);
  const byKey = new Map(occurrences.map((o) => [o.key, o]));
  for (const [needId] of analysed) {
    const row = current.coverage.find((c) => c.needId === needId && c.missing > 0);
    const occ = row ? byKey.get(row.key) : undefined;
    if (!occ) continue;
    if (occ.skill !== undefined) {
      const lacking = space.resources
        .filter((r) => !r.skills.includes(occ.skill!))
        .filter((r) => whyNot(space, byKey, planning, r, occ).every((w) => w.kind === "skill"))
        .sort((a, b) => (loadOf.get(a.id) ?? 0) - (loadOf.get(b.id) ?? 0))
        .slice(0, 3);
      for (const r of lacking) add(`skill|${r.id}|${occ.skill}`, `Former ${r.name} à « ${occ.skill} »`, { type: "addSkill", resourceId: r.id, skill: occ.skill }, needId);
    }
    const restricted = space.resources
      .filter((r) => (occ.skill === undefined || r.skills.includes(occ.skill)) && r.weekly.length > 0)
      .filter((r) => {
        const why = whyNot(space, byKey, planning, r, occ);
        return why.length > 0 && why.every((w) => w.kind === "unavailable" && w.text.startsWith("non disponible"));
      })
      .slice(0, 3);
    for (const r of restricted) add(`avail|${r.id}`, `Demander à ${r.name} de lever ses restrictions horaires`, { type: "clearAvailability", resourceId: r.id }, needId);
  }

  const results = new Map<string, Analysis>();
  for (const c of candidates.values()) {
    const variant = applyPatch(space, options.periodId, c.patch);
    const r = await solvePeriod(variant, c.patch.type === "unlock" ? { ...trial, freezeExisting: false } : trial);
    if (r.status === "optimal" || r.status === "feasible") results.set(c.key, r.analysis);
  }

  const diagnoses: NeedDiagnosis[] = analysed.map(([needId, info]) => {
    const { causes } = explained.get(needId)!;
    const baseMissing = missingOf(baseline.analysis, needId);
    const notes = [...causes];
    if (baseMissing === 0) notes.push("Un nouveau calcul pourvoirait pourtant toutes les places de ce besoin : le planning affiché a peut-être été modifié à la main.");
    const suggestions: Suggestion[] = [];
    for (const c of candidates.values()) {
      if (!c.needs.has(needId)) continue;
      const a = results.get(c.key);
      if (!a) continue;
      const after = missingOf(a, needId);
      if (after >= baseMissing) continue;
      const collateral = [...new Set(a.coverage.map((x) => x.needId))].flatMap((id) => {
        if (id === needId) return [];
        const lost = missingOf(a, id) - missingOf(baseline.analysis, id);
        return lost > 0 ? [{ needId: id, label: space.needs.find((n) => n.id === id)?.label ?? id, lost }] : [];
      });
      suggestions.push({ description: c.description, patch: c.patch, missingAfter: after, totalMissingAfter: a.missingSeats, collateral });
    }
    suggestions.sort((x, y) => {
      const fx = x.missingAfter === 0 ? 0 : 1;
      const fy = y.missingAfter === 0 ? 0 : 1;
      return fx - fy || x.collateral.length - y.collateral.length || x.missingAfter - y.missingAfter;
    });
    return { needId, label: info.label, missing: info.missing, totalMissing: info.total, causes: notes, suggestions };
  });
  return { diagnoses, skipped, baselineMissing: baseline.analysis.missingSeats };
}
