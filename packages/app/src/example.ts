import { spaceSchema, type Space } from "@planning/core";

/** Supermarché fictif pour essayer le logiciel : quatre semaines de novembre 2026. */
export function exampleSpace(): Space {
  const person = (id: string, name: string, skills: string[], weekHours: number, extra: Record<string, unknown> = {}) => ({
    id, name, skills, contract: { targetWeekUnits: weekHours * 4 }, ...extra,
  });
  return spaceSchema.parse({
    id: "supermarche-demo",
    name: "Supermarché de Démo",
    resources: [
      person("lea", "Léa", ["caisse", "stock"], 35, { preferences: { preferDays: [0, 1], avoidDays: [5] } }),
      person("tom", "Tom", ["caisse"], 35, { absences: [{ start: "2026-11-16", end: "2026-11-20", reason: "congés" }] }),
      person("ines", "Inès", ["caisse"], 28, { weekly: [{ days: [0, 1, 2, 3, 4, 5], start: "08:00", end: "19:00" }], preferences: { offDates: ["2026-11-14"] } }),
      person("karim", "Karim", ["stock"], 35),
      person("anna", "Anna", ["caisse", "stock"], 35),
      person("hugo", "Hugo", ["caisse"], 20, { weekly: [{ days: [2, 5, 6], start: "07:00", end: "21:00" }] }),
      person("sam", "Sam", ["stock"], 30, { preferences: { avoidNeedIds: ["dimanche"] } }),
      person("nora", "Nora", ["caisse", "stock"], 35, { contract: { targetWeekUnits: 140, maxConsecutiveDays: 5 } }),
    ],
    needs: [
      { id: "caisse-matin", label: "Caisse matin", skill: "caisse", days: [0, 1, 2, 3, 4, 5], start: "07:30", end: "14:00", required: 2, priority: 4, max: 3 },
      { id: "caisse-aprem", label: "Caisse après-midi", skill: "caisse", days: [0, 1, 2, 3, 4, 5], start: "13:30", end: "20:00", required: 2, priority: 4, max: 3 },
      { id: "reception", label: "Réception marchandises", skill: "stock", days: [0, 1, 2, 3, 4, 5], start: "06:00", end: "12:00", required: 1, priority: 3 },
      { id: "dimanche", label: "Ouverture dimanche", skill: "caisse", days: [6], start: "09:00", end: "13:00", required: 2, priority: 2, unpopular: true },
      { id: "samedi-renfort", label: "Renfort samedi", days: [5], start: "10:00", end: "18:00", required: 1, priority: 2, unpopular: true },
    ],
    periods: [{ id: "nov", name: "Novembre 2026", start: "2026-11-02", end: "2026-11-29" }],
    closures: [{ start: "2026-11-11", end: "2026-11-11", label: "Armistice" }],
    plannings: [],
  });
}
