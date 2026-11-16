import { periodOccurrences } from "./calendar.js";
import type { Space } from "./model.js";
import { formatTime, weekday } from "./time.js";

const DAY_LONG = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Une ligne par personne et par vacation, séparateur « ; » (s'ouvre directement dans un tableur français). */
export function planningToCsv(space: Space, periodId: string): string {
  const planning = space.plannings.find((p) => p.periodId === periodId);
  const occ = new Map(periodOccurrences(space, periodId).map((o) => [o.key, o]));
  const names = new Map(space.resources.map((r) => [r.id, r.name]));
  const rows = (planning?.assignments ?? []).flatMap((a) => {
    const o = occ.get(`${a.needId}|${a.date}`);
    return o ? [{ a, o }] : [];
  });
  rows.sort((x, y) => x.a.date.localeCompare(y.a.date) || x.o.start - y.o.start || (names.get(x.a.resourceId) ?? "").localeCompare(names.get(y.a.resourceId) ?? ""));
  const lines = [["Date", "Jour", "Début", "Fin", "Vacation", "Compétence", "Personne"].join(";")];
  for (const { a, o } of rows) {
    lines.push(
      [a.date, DAY_LONG[weekday(a.date)]!, formatTime(o.start), formatTime(o.end > 96 ? o.end - 96 : o.end), o.label, o.skill ?? "", names.get(a.resourceId) ?? a.resourceId]
        .map(csvCell)
        .join(";"),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const icsStamp = (date: string, units: number) => {
  const d = new Date(Date.parse(`${date}T00:00:00Z`) + units * 15 * 60_000);
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15);
};

/** Calendrier iCalendar (.ics) des vacations d'une personne : à importer dans l'agenda de son choix. Heures locales (« flottantes »). */
export function planningToIcs(space: Space, periodId: string, resourceId: string): string {
  const planning = space.plannings.find((p) => p.periodId === periodId);
  const resource = space.resources.find((r) => r.id === resourceId);
  const occ = new Map(periodOccurrences(space, periodId).map((o) => [o.key, o]));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Le planning d'Alix//FR", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsEscape(resource?.name ?? "Planning")}`];
  for (const a of planning?.assignments ?? []) {
    if (a.resourceId !== resourceId) continue;
    const o = occ.get(`${a.needId}|${a.date}`);
    if (!o) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${a.needId}-${a.date}-${resourceId}@planning.potodugoud.fr`,
      `DTSTAMP:${icsStamp(a.date, 0)}Z`,
      `DTSTART:${icsStamp(a.date, o.start)}`,
      `DTEND:${icsStamp(a.date, o.end)}`,
      `SUMMARY:${icsEscape(o.label)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
