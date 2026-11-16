import {
  absEnd,
  absStart,

  daysBetween,
  hasSkill,
  isForbidden,
  limitsOf,
  mondayOf,
  occurrenceDuration,
  periodOccurrences,
  unavailableReason,
  weekTarget,
  weekday,
  type Occurrence,
  type Planning,
  type Resource,
  type Space,
} from "@planning/core";
import { MilpModel } from "./milp.js";

/**
 * Poids des objectifs, par ordre de grandeur voulu : pourvoir une place (10 000 × priorité du besoin)
 * l'emporte sur tout le reste, puis viennent les heures de contrat, l'équité des vacations pénibles,
 * la stabilité et enfin les préférences. Aucun de ces poids ne peut rendre une règle dure négociable.
 */
export interface Weights {
  /** Par place pourvue, multiplié par la priorité du besoin. */
  coverage: number;
  /** Par quart d'heure sous la durée hebdomadaire visée. */
  underTarget: number;
  /** Par quart d'heure au-dessus de la durée visée (moins grave que d'en manquer : il faut parfois dépanner). */
  overTarget: number;
  /** Par place au-delà de l'effectif requis. */
  overstaff: number;
  /** Par vacation qui correspond (ou non) à un souhait de jour ou de besoin. */
  preference: number;
  /** Par vacation posée un jour où la personne a demandé à être libre. */
  offDate: number;
  /** Par vacation pénible de la personne la plus chargée : fait baisser la charge maximale. */
  fairness: number;
  /** Par affectation conservée du planning de référence. */
  stability: number;
  /** Idem quand la stabilité est imposée (l'emporte sur tout sauf les règles dures). */
  stabilityImposed: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  coverage: 10_000,
  underTarget: 40,
  overTarget: 20,
  overstaff: 50,
  preference: 20,
  offDate: 150,
  fairness: 300,
  stability: 100,
  stabilityImposed: 100_000,
};

export type StabilityMode = "ignored" | "preferred" | "imposed";

export interface ProblemOptions {
  periodId: string;
  weights?: Partial<Weights>;
  /** Planning de référence pour la stabilité (en général : le planning actuel, qu'on veut modifier le moins possible). */
  reference?: Planning;
  /** Défaut : « preferred » s'il y a une référence, sinon « ignored ». */
  stability?: StabilityMode;
  /** Traite toutes les affectations déjà placées comme verrouillées : seul le reste est calculé. */
  freezeExisting?: boolean;
}

/** Une affectation candidate : la variable vaut 1 si la personne est placée sur la vacation. */
export interface AssignmentVar {
  v: number;
  occ: Occurrence;
  resourceId: string;
}

export interface Problem {
  model: MilpModel;
  vars: AssignmentVar[];
  occurrences: Occurrence[];
  /** Affectations verrouillées impossibles à respecter. */
  lockedMissing: string[];
  warnings: string[];
}

const assignmentKey = (needId: string, date: string, resourceId: string) => `${needId}|${date}|${resourceId}`;

/** Peut-on envisager de placer cette personne sur cette vacation (compétence, disponibilité, interdiction) ? */
export function isEligible(resource: Resource, occ: Occurrence, planning: Planning | undefined): boolean {
  return hasSkill(resource, occ.skill) && !isForbidden(planning, resource.id, occ) && unavailableReason(resource, occ) === null;
}

export function buildProblem(space: Space, options: ProblemOptions): Problem {
  const period = space.periods.find((p) => p.id === options.periodId);
  if (!period) throw new Error(`Période inconnue : « ${options.periodId} »`);
  const weights: Weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const planning = space.plannings.find((p) => p.periodId === options.periodId);
  const occurrences = periodOccurrences(space, options.periodId);
  const nDays = daysBetween(period.start, period.end) + 1;
  const warnings: string[] = [];
  const model = new MilpModel();

  const stability: StabilityMode = options.stability ?? (options.reference ? "preferred" : "ignored");
  const referenceKeys = new Set((options.reference?.assignments ?? []).map((a) => assignmentKey(a.needId, a.date, a.resourceId)));

  const vars: AssignmentVar[] = [];
  const byKey = new Map<string, AssignmentVar>();
  const byOcc = new Map<string, AssignmentVar[]>();
  const byRes = new Map<string, AssignmentVar[]>();

  // ---- variables et objectif par affectation
  for (const occ of occurrences) {
    for (const r of space.resources) {
      if (!isEligible(r, occ, planning)) continue;
      const v = model.addBinary();
      const av: AssignmentVar = { v, occ, resourceId: r.id };
      vars.push(av);
      byKey.set(assignmentKey(occ.needId, occ.date, r.id), av);
      (byOcc.get(occ.key) ?? byOcc.set(occ.key, []).get(occ.key)!).push(av);
      (byRes.get(r.id) ?? byRes.set(r.id, []).get(r.id)!).push(av);

      let gain = 0;
      const p = r.preferences;
      const day = weekday(occ.date);
      if (p.preferDays.includes(day)) gain += weights.preference;
      if (p.avoidDays.includes(day)) gain -= weights.preference;
      if (p.preferNeedIds.includes(occ.needId)) gain += weights.preference;
      if (p.avoidNeedIds.includes(occ.needId)) gain -= weights.preference;
      if (p.offDates.includes(occ.date)) gain -= weights.offDate;
      if (stability !== "ignored" && referenceKeys.has(assignmentKey(occ.needId, occ.date, r.id))) {
        gain += stability === "imposed" ? weights.stabilityImposed : weights.stability;
      }
      if (gain !== 0) model.addObjective(v, gain);
    }
  }

  // ---- couverture : pourvoir les places, sans dépasser le maximum
  const uncoverable = new Map<string, number>();
  for (const occ of occurrences) {
    const list = byOcc.get(occ.key) ?? [];
    if (list.length === 0) {
      uncoverable.set(occ.needId, (uncoverable.get(occ.needId) ?? 0) + 1);
      continue;
    }
    const sum = list.map((a) => [a.v, 1] as const);
    model.addRow(sum, "<=", occ.max);
    const covered = model.addContinuous(occ.required);
    model.addRow([[covered, 1], ...list.map((a) => [a.v, -1] as const)], "<=", 0);
    model.addObjective(covered, weights.coverage * occ.priority);
    if (occ.max > occ.required) {
      const extra = model.addContinuous(occ.max - occ.required);
      model.addRow([...sum, [extra, -1] as const], "<=", occ.required);
      model.addObjective(extra, -weights.overstaff);
    }
  }
  for (const [needId, count] of uncoverable) {
    const label = space.needs.find((n) => n.id === needId)?.label ?? needId;
    warnings.push(`Personne ne peut pourvoir « ${label} » (compétence, disponibilités ou interdictions) sur ${count} jour(s) : ces places resteront vides.`);
  }

  // ---- affectations verrouillées
  const lockedMissing: string[] = [];
  for (const a of planning?.assignments ?? []) {
    if (!(a.locked || options.freezeExisting)) continue;
    const av = byKey.get(assignmentKey(a.needId, a.date, a.resourceId));
    if (av) model.addRow([[av.v, 1]], "=", 1);
    else {
      const key = assignmentKey(a.needId, a.date, a.resourceId);
      lockedMissing.push(key);
      const who = space.resources.find((r) => r.id === a.resourceId)?.name ?? a.resourceId;
      const what = space.needs.find((n) => n.id === a.needId)?.label ?? a.needId;
      warnings.push(`Affectation verrouillée impossible à respecter : ${who} sur « ${what} » le ${a.date} (compétence, disponibilité ou vacation inexistante).`);
    }
  }

  // ---- règles propres à chaque personne
  const unpopularByResource: [string, AssignmentVar[]][] = [];
  for (const r of space.resources) {
    const mine = byRes.get(r.id) ?? [];
    if (mine.length === 0) continue;
    const limits = limitsOf(space, r);
    addRestConstraints(model, mine, limits.minRest);
    addTotalConstraints(model, mine, (a) => a.occ.date, limits.maxDay);
    addTotalConstraints(model, mine, (a) => mondayOf(a.occ.date), limits.maxWeek);
    addConsecutiveConstraints(model, mine, limits.maxConsecutive, nDays);
    addTargetTerms(model, mine, r, period.start, period.end, weights, limits.maxWeek);
    const unpopular = mine.filter((a) => a.occ.unpopular);
    if (unpopular.length > 0) unpopularByResource.push([r.id, unpopular]);
  }

  // ---- équité : abaisser la charge de la personne la plus chargée en vacations pénibles
  if (unpopularByResource.length >= 2 && weights.fairness > 0) {
    const total = new Set(unpopularByResource.flatMap(([, l]) => l.map((a) => a.occ.key))).size;
    const peak = model.addContinuous(Math.max(1, total));
    for (const [, list] of unpopularByResource) model.addRow([...list.map((a) => [a.v, 1] as const), [peak, -1] as const], "<=", 0);
    model.addObjective(peak, -weights.fairness);
  }

  return { model, vars, occurrences, lockedMissing, warnings };
}

/**
 * Ni chevauchement ni repos insuffisant : on prolonge chaque vacation du repos minimal, puis on
 * interdit que deux vacations prolongées se recouvrent. À chaque début de vacation, l'ensemble des
 * vacations en cours est une « clique » : une seule peut être retenue.
 */
function addRestConstraints(model: MilpModel, list: AssignmentVar[], rest: number): void {
  const sorted = [...list].sort((a, b) => absStart(a.occ) - absStart(b.occ));
  const starts = [...new Set(sorted.map((a) => absStart(a.occ)))];
  const active = new Set<AssignmentVar>();
  let next = 0;
  for (const t of starts) {
    for (const a of active) if (absEnd(a.occ) + rest <= t) active.delete(a);
    let added = false;
    while (next < sorted.length && absStart(sorted[next]!.occ) <= t) {
      active.add(sorted[next]!);
      next++;
      added = true;
    }
    if (added && active.size >= 2) model.addRow([...active].map((a) => [a.v, 1] as const), "<=", 1);
  }
}

/** Durée totale plafonnée par groupe (jour, semaine). N'ajoute la contrainte que si le plafond peut être dépassé. */
function addTotalConstraints(model: MilpModel, list: AssignmentVar[], group: (a: AssignmentVar) => string, limit: number): void {
  const groups = new Map<string, AssignmentVar[]>();
  for (const a of list) {
    const g = group(a);
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(a);
  }
  for (const members of groups.values()) {
    const total = members.reduce((n, a) => n + occurrenceDuration(a.occ), 0);
    if (total > limit) model.addRow(members.map((a) => [a.v, occurrenceDuration(a.occ)] as const), "<=", limit);
  }
}

/** Au plus K jours de travail d'affilée : sur toute fenêtre de K + 1 jours, au moins un jour libre. */
function addConsecutiveConstraints(model: MilpModel, list: AssignmentVar[], k: number, nDays: number): void {
  if (k >= nDays) return;
  const byDay = new Map<number, AssignmentVar[]>();
  for (const a of list) (byDay.get(a.occ.dayIndex) ?? byDay.set(a.occ.dayIndex, []).get(a.occ.dayIndex)!).push(a);
  // variable « travaille ce jour-là » : la variable elle-même s'il n'y a qu'une vacation possible
  const worked = new Map<number, number>();
  for (const [day, members] of byDay) {
    if (members.length === 1) worked.set(day, members[0]!.v);
    else {
      const y = model.addBinary();
      for (const a of members) model.addRow([[a.v, 1], [y, -1]], "<=", 0);
      worked.set(day, y);
    }
  }
  for (let i = 0; i + k < nDays; i++) {
    const terms: [number, number][] = [];
    for (let d = i; d <= i + k; d++) {
      const y = worked.get(d);
      if (y !== undefined) terms.push([y, 1]);
    }
    if (terms.length > k) model.addRow(terms, "<=", k);
  }
}

/** Durée hebdomadaire visée : l'écart (en moins ou en plus) coûte, sans jamais être interdit. */
function addTargetTerms(model: MilpModel, list: AssignmentVar[], r: Resource, start: string, end: string, w: Weights, maxWeek: number): void {
  if (r.contract.targetWeekUnits === undefined) return;
  const weeks = new Map<string, AssignmentVar[]>();
  for (const a of list) {
    const m = mondayOf(a.occ.date);
    (weeks.get(m) ?? weeks.set(m, []).get(m)!).push(a);
  }
  for (const [monday, members] of weeks) {
    const target = weekTarget(r, start, end, monday) ?? 0;
    const hours = members.map((a) => [a.v, occurrenceDuration(a.occ)] as const);
    if (target > 0) {
      const under = model.addContinuous(target);
      model.addRow([...hours, [under, 1]], ">=", target);
      model.addObjective(under, -w.underTarget);
    }
    const over = model.addContinuous(maxWeek);
    model.addRow([...hours, [over, -1]], "<=", target);
    model.addObjective(over, -w.overTarget);
  }
}


