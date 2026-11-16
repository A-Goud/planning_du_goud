import type { Closure, Need, Period, Space } from "./model.js";
import { UNITS_PER_DAY, parseEndTime, parseTime, weekday } from "./time.js";

const DAY_MS = 86_400_000;

const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  return fromMs(toMs(date) + n * DAY_MS);
}

/** Nombre de jours entre deux dates (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

/** Lundi de la semaine qui contient la date. */
export function mondayOf(date: string): string {
  return addDays(date, -weekday(date));
}

/** Toutes les dates de start à end incluses. */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Une vacation à pourvoir un jour précis (un besoin, développé sur le calendrier d'une période).
 * `start` et `end` sont en unités de 15 min depuis minuit du jour `date` ; `end` dépasse 96 pour une vacation de nuit.
 */
export interface Occurrence {
  /** Identifiant stable : « besoin|date ». */
  key: string;
  needId: string;
  label: string;
  date: string;
  /** Jours écoulés depuis le début de la période. */
  dayIndex: number;
  start: number;
  end: number;
  required: number;
  max: number;
  priority: number;
  unpopular: boolean;
  skill: string | undefined;
}

export const occurrenceKey = (needId: string, date: string) => `${needId}|${date}`;

export function occurrenceDuration(o: Pick<Occurrence, "start" | "end">): number {
  return o.end - o.start;
}

/** Début et fin absolus (unités de 15 min depuis minuit du premier jour de la période). */
export function absStart(o: Pick<Occurrence, "dayIndex" | "start">): number {
  return o.dayIndex * UNITS_PER_DAY + o.start;
}
export function absEnd(o: Pick<Occurrence, "dayIndex" | "end">): number {
  return o.dayIndex * UNITS_PER_DAY + o.end;
}

/** Fin d'une vacation, en unités depuis minuit du jour de début (au-delà de 96 : le lendemain). */
export function needEndUnits(need: Pick<Need, "start" | "end">): number {
  const s = parseTime(need.start);
  const e = parseEndTime(need.end);
  return e > s ? e : e + UNITS_PER_DAY;
}

export function needsOfPeriod(space: Space, periodId: string): Need[] {
  return space.needs.filter((n) => n.periodIds.length === 0 || n.periodIds.includes(periodId));
}

export function isClosed(closures: Closure[], date: string): Closure | undefined {
  return closures.find((c) => c.start <= date && date <= c.end);
}

/** Développe les besoins d'une période en vacations datées, triées par date puis heure. */
export function periodOccurrences(space: Space, periodId: string): Occurrence[] {
  const period = space.periods.find((p) => p.id === periodId);
  if (!period) return [];
  const out: Occurrence[] = [];
  const dates = eachDate(period.start, period.end);
  for (const need of needsOfPeriod(space, periodId)) {
    const start = parseTime(need.start);
    const end = needEndUnits(need);
    const extra = new Set(need.extraDates);
    dates.forEach((date, dayIndex) => {
      const recurring = need.days.includes(weekday(date)) && !isClosed(space.closures, date);
      if (!recurring && !extra.has(date)) return;
      const exception = need.exceptions.find((x) => x.date === date);
      const required = exception ? exception.required : need.required;
      if (required <= 0) return;
      const max = exception && need.max === undefined ? required : Math.max(need.max ?? need.required, required);
      out.push({
        key: occurrenceKey(need.id, date),
        needId: need.id,
        label: need.label,
        date,
        dayIndex,
        start,
        end,
        required,
        max,
        priority: need.priority,
        unpopular: need.unpopular,
        skill: need.skill,
      });
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.needId.localeCompare(b.needId));
}

/**
 * Propose des périodes : les tranches entre deux fermetures générales, découpées en morceaux
 * d'environ `targetWeeks` semaines. Ce ne sont que des propositions : l'utilisateur garde la main.
 */
export function suggestPeriods(rangeStart: string, rangeEnd: string, closures: Closure[], targetWeeks = 4): Omit<Period, "id">[] {
  const sorted = [...closures].filter((c) => c.end >= rangeStart && c.start <= rangeEnd).sort((a, b) => a.start.localeCompare(b.start));
  const stretches: [string, string][] = [];
  let cursor = rangeStart;
  for (const c of sorted) {
    if (c.start > cursor) stretches.push([cursor, addDays(c.start, -1)]);
    if (addDays(c.end, 1) > cursor) cursor = addDays(c.end, 1);
  }
  if (cursor <= rangeEnd) stretches.push([cursor, rangeEnd]);

  const out: Omit<Period, "id">[] = [];
  for (const [start, end] of stretches) {
    const days = daysBetween(start, end) + 1;
    const weeks = Math.max(1, Math.round(days / 7));
    const parts = Math.max(1, Math.round(weeks / targetWeeks));
    const each = Math.ceil(days / parts);
    for (let i = 0; i < parts; i++) {
      const s = addDays(start, i * each);
      if (s > end) break;
      const e = i === parts - 1 ? end : addDays(s, each - 1);
      out.push({ name: `${s} → ${e}`, start: s, end: e });
    }
  }
  return out;
}
