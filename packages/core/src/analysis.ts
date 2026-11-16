import { addDays, mondayOf, occurrenceDuration, periodOccurrences } from "./calendar.js";
import type { Planning, Resource, Space } from "./model.js";
import { absenceOn, formatDate, formatHours, hasSkill, isForbidden, limitsOf, pairConflict, unavailableReason } from "./rules.js";

/** Cible hebdomadaire d'une personne sur une semaine partiellement couverte par la période ou par ses absences (au prorata des jours). */
export function weekTarget(resource: Resource, periodStart: string, periodEnd: string, monday: string): number | undefined {
  const target = resource.contract.targetWeekUnits;
  if (target === undefined) return undefined;
  let days = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (d >= periodStart && d <= periodEnd && !absenceOn(resource, d)) days++;
  }
  return Math.round((target * days) / 7);
}

export interface CoverageRow {
  key: string;
  needId: string;
  label: string;
  date: string;
  start: number;
  end: number;
  required: number;
  max: number;
  assigned: number;
  missing: number;
  priority: number;
}

export interface ResourceLoad {
  resourceId: string;
  name: string;
  weeks: { monday: string; units: number; target: number | undefined }[];
  totalUnits: number;
  /** Nombre de vacations pénibles. */
  unpopular: number;
  daysWorked: number;
  shifts: number;
  /** Quarts d'heure manquants par rapport à la cible, additionnés sur les semaines. */
  underTargetUnits: number;
}

export interface Analysis {
  coverage: CoverageRow[];
  loads: ResourceLoad[];
  /** Règles dures violées par le planning (placements manuels, par exemple). */
  violations: string[];
  missingSeats: number;
  underTargetUnits: number;
}

/** Bilan d'un planning : couverture des besoins, charge de chacun, règles violées. */
export function analyzePlanning(space: Space, periodId: string, planningOverride?: Planning): Analysis {
  const period = space.periods.find((p) => p.id === periodId);
  const planning = planningOverride ?? space.plannings.find((p) => p.periodId === periodId);
  const occurrences = periodOccurrences(space, periodId);
  const byKey = new Map(occurrences.map((o) => [o.key, o]));
  const resources = new Map(space.resources.map((r) => [r.id, r]));
  const assignments = planning?.assignments ?? [];

  const counts = new Map<string, number>();
  for (const a of assignments) {
    const key = `${a.needId}|${a.date}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const coverage: CoverageRow[] = occurrences.map((o) => {
    const assigned = counts.get(o.key) ?? 0;
    return {
      key: o.key, needId: o.needId, label: o.label, date: o.date, start: o.start, end: o.end,
      required: o.required, max: o.max, assigned, missing: Math.max(0, o.required - assigned), priority: o.priority,
    };
  });

  const violations: string[] = [];
  const loads: ResourceLoad[] = [];
  for (const r of space.resources) {
    const mine = assignments.flatMap((a) => {
      if (a.resourceId !== r.id) return [];
      const o = byKey.get(`${a.needId}|${a.date}`);
      return o ? [o] : [];
    });
    mine.sort((a, b) => a.dayIndex * 96 + a.start - (b.dayIndex * 96 + b.start));
    const limits = limitsOf(space, r);

    for (const o of mine) {
      const where = `${r.name} — « ${o.label} » ${formatDate(o.date)}`;
      if (!hasSkill(r, o.skill)) violations.push(`${where} : n'a pas la compétence « ${o.skill} ».`);
      const un = unavailableReason(r, o);
      if (un) violations.push(`${where} : ${un}.`);
      if (isForbidden(planning, r.id, o)) violations.push(`${where} : placement interdit.`);
    }
    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) {
        const a = mine[i]!;
        const b = mine[j]!;
        if (b.dayIndex - a.dayIndex > 3) break;
        const c = pairConflict(a, b, limits.minRest);
        if (c === "overlap") violations.push(`${r.name} : « ${a.label} » ${formatDate(a.date)} et « ${b.label} » ${formatDate(b.date)} se chevauchent.`);
        else if (c === "rest") violations.push(`${r.name} : repos insuffisant entre « ${a.label} » ${formatDate(a.date)} et « ${b.label} » ${formatDate(b.date)}.`);
      }
    }

    const perDay = new Map<string, number>();
    const perWeek = new Map<string, number>();
    for (const o of mine) {
      const d = occurrenceDuration(o);
      perDay.set(o.date, (perDay.get(o.date) ?? 0) + d);
      const m = mondayOf(o.date);
      perWeek.set(m, (perWeek.get(m) ?? 0) + d);
    }
    for (const [date, units] of perDay) {
      if (units > limits.maxDay) violations.push(`${r.name} : ${formatHours(units)} le ${formatDate(date)} (maximum ${formatHours(limits.maxDay)}).`);
    }
    for (const [monday, units] of perWeek) {
      if (units > limits.maxWeek) violations.push(`${r.name} : ${formatHours(units)} la semaine du ${monday} (maximum ${formatHours(limits.maxWeek)}).`);
    }
    const days = [...new Set(mine.map((o) => o.dayIndex))].sort((a, b) => a - b);
    let run = 0;
    let prev = -10;
    for (const d of days) {
      run = d === prev + 1 ? run + 1 : 1;
      prev = d;
      if (run === limits.maxConsecutive + 1 && period) {
        violations.push(`${r.name} : plus de ${limits.maxConsecutive} jours de suite (jusqu'au ${formatDate(addDays(period.start, d))}).`);
      }
    }

    const weeks: ResourceLoad["weeks"] = [];
    let under = 0;
    if (period) {
      for (let m = mondayOf(period.start); m <= period.end; m = addDays(m, 7)) {
        const units = perWeek.get(m) ?? 0;
        const target = weekTarget(r, period.start, period.end, m);
        weeks.push({ monday: m, units, target });
        if (target !== undefined && units < target) under += target - units;
      }
    }
    loads.push({
      resourceId: r.id,
      name: r.name,
      weeks,
      totalUnits: mine.reduce((n, o) => n + occurrenceDuration(o), 0),
      unpopular: mine.filter((o) => o.unpopular).length,
      daysWorked: days.length,
      shifts: mine.length,
      underTargetUnits: under,
    });
  }

  // affectations qui ne correspondent à aucune vacation du calendrier (besoin supprimé, jour fermé…)
  for (const a of assignments) {
    if (!byKey.has(`${a.needId}|${a.date}`)) {
      const name = resources.get(a.resourceId)?.name ?? a.resourceId;
      violations.push(`${name} : affectation sur « ${a.needId} » le ${a.date}, qui n'est plus une vacation de cette période.`);
    }
  }

  return {
    coverage,
    loads,
    violations,
    missingSeats: coverage.reduce((n, c) => n + c.missing, 0),
    underTargetUnits: loads.reduce((n, l) => n + l.underTargetUnits, 0),
  };
}

