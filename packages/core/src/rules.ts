import { absEnd, absStart, mondayOf, occurrenceDuration, type Occurrence } from "./calendar.js";
import type { Assignment, Planning, Resource, Space } from "./model.js";
import { UNITS_PER_DAY, formatTime, parseEndTime, parseTime, weekday } from "./time.js";

const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** Limites qui s'appliquent à une personne : son cadre de travail, sinon les règles par défaut de l'espace. */
export interface Limits {
  minRest: number;
  maxConsecutive: number;
  maxDay: number;
  maxWeek: number;
}

export function limitsOf(space: Space, resource: Resource): Limits {
  const c = resource.contract;
  const r = space.rules;
  return {
    minRest: c.minRestUnits ?? r.minRestUnits,
    maxConsecutive: c.maxConsecutiveDays ?? r.maxConsecutiveDays,
    maxDay: c.maxDayUnits ?? r.maxDayUnits,
    maxWeek: c.maxWeekUnits ?? r.maxWeekUnits,
  };
}

export function hasSkill(resource: Resource, skill: string | undefined): boolean {
  return skill === undefined || resource.skills.includes(skill);
}

export function absenceOn(resource: Resource, date: string) {
  return resource.absences.find((a) => a.start <= date && date <= a.end);
}

/** Les morceaux d'une vacation par jour civil : [date, début, fin) en unités depuis minuit de ce jour. */
function segments(o: Pick<Occurrence, "date" | "start" | "end">, nextDate: () => string): { date: string; s: number; e: number }[] {
  const first = { date: o.date, s: o.start, e: Math.min(o.end, UNITS_PER_DAY) };
  return o.end > UNITS_PER_DAY ? [first, { date: nextDate(), s: 0, e: o.end - UNITS_PER_DAY }] : [first];
}

/** Raison pour laquelle la personne ne peut pas travailler sur cette vacation (absence, disponibilités), ou null. */
export function unavailableReason(resource: Resource, o: Pick<Occurrence, "date" | "start" | "end">): string | null {
  const next = () => new Date(Date.parse(`${o.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  for (const seg of segments(o, next)) {
    const absence = absenceOn(resource, seg.date);
    if (absence) return `absent(e)${absence.reason ? ` (${absence.reason})` : ""}`;
    if (resource.weekly.length > 0) {
      const day = weekday(seg.date);
      const ok = resource.weekly.some((w) => w.days.includes(day) && parseTime(w.start) <= seg.s && seg.e <= parseEndTime(w.end));
      if (!ok) return `non disponible le ${DAY_NAMES[day]} de ${formatTime(seg.s)} à ${formatTime(seg.e)}`;
    }
  }
  return null;
}

/** Interdiction posée par l'utilisateur sur cette vacation ? */
export function isForbidden(planning: Planning | undefined, resourceId: string, o: Pick<Occurrence, "date" | "needId">): boolean {
  return (planning?.forbidden ?? []).some((f) => f.resourceId === resourceId && f.date === o.date && (f.needId === undefined || f.needId === o.needId));
}

/** Deux vacations d'une même personne : se chevauchent-elles, ou le repos entre elles est-il trop court ? */
export function pairConflict(a: Occurrence, b: Occurrence, minRest: number): "overlap" | "rest" | null {
  const [first, second] = absStart(a) <= absStart(b) ? [a, b] : [b, a];
  const gap = absStart(second) - absEnd(first);
  if (gap < 0) return "overlap";
  return gap < minRest ? "rest" : null;
}

const formatDate = (date: string) => `${DAY_NAMES[weekday(date)]} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
export { formatDate };

/** Prochaines heures : « 2 h 15 » à partir d'unités de 15 min. */
export function formatHours(units: number): string {
  const minutes = Math.round(units * 15);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

export type WhyKind = "skill" | "forbidden" | "unavailable" | "overlap" | "rest" | "day" | "week" | "consecutive";
export interface Why {
  kind: WhyKind;
  text: string;
}

/**
 * Pourquoi cette personne ne peut pas être ajoutée à cette vacation, compte tenu de ce qu'elle fait déjà
 * dans le planning. Liste vide : elle peut y être placée.
 */
export function whyNot(
  space: Space,
  occurrences: Map<string, Occurrence>,
  planning: Planning | undefined,
  resource: Resource,
  cand: Occurrence,
): Why[] {
  const out: Why[] = [];
  if (!hasSkill(resource, cand.skill)) out.push({ kind: "skill", text: `n'a pas la compétence « ${cand.skill} »` });
  if (isForbidden(planning, resource.id, cand)) out.push({ kind: "forbidden", text: "interdit(e) par l'utilisateur sur cette vacation" });
  const unavailable = unavailableReason(resource, cand);
  if (unavailable) out.push({ kind: "unavailable", text: unavailable });

  const limits = limitsOf(space, resource);
  const others = (planning?.assignments ?? [])
    .filter((a) => a.resourceId === resource.id && !(a.needId === cand.needId && a.date === cand.date))
    .flatMap((a) => {
      const o = occurrences.get(`${a.needId}|${a.date}`);
      return o ? [o] : [];
    });

  for (const o of others) {
    const c = pairConflict(cand, o, limits.minRest);
    if (c === "overlap") out.push({ kind: "overlap", text: `déjà placé(e) sur « ${o.label} » ${formatDate(o.date)} (même moment)` });
    else if (c === "rest") out.push({ kind: "rest", text: `repos insuffisant après/avant « ${o.label} » ${formatDate(o.date)}` });
  }
  const sameDay = others.filter((o) => o.date === cand.date).reduce((n, o) => n + occurrenceDuration(o), 0) + occurrenceDuration(cand);
  if (sameDay > limits.maxDay) out.push({ kind: "day", text: `dépasserait ${formatHours(limits.maxDay)} dans la journée` });
  const monday = mondayOf(cand.date);
  const sameWeek = others.filter((o) => mondayOf(o.date) === monday).reduce((n, o) => n + occurrenceDuration(o), 0) + occurrenceDuration(cand);
  if (sameWeek > limits.maxWeek) out.push({ kind: "week", text: `dépasserait ${formatHours(limits.maxWeek)} dans la semaine (${formatHours(sameWeek)})` });

  const worked = new Set(others.map((o) => o.dayIndex));
  let run = 1;
  for (let d = cand.dayIndex - 1; worked.has(d); d--) run++;
  for (let d = cand.dayIndex + 1; worked.has(d); d++) run++;
  if (run > limits.maxConsecutive) out.push({ kind: "consecutive", text: `ferait ${run} jours de suite (maximum ${limits.maxConsecutive})` });
  return out;
}

/** Les affectations d'une personne, dans l'ordre chronologique. */
export function assignmentsOf(planning: Planning | undefined, resourceId: string): Assignment[] {
  return (planning?.assignments ?? []).filter((a) => a.resourceId === resourceId);
}
