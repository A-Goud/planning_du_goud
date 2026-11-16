import { describe, expect, it } from "vitest";
import {
  analyzePlanning,
  exportSpace,
  importSpace,
  periodOccurrences,
  planningToCsv,
  planningToIcs,
  spaceSchema,
  suggestPeriods,
  unavailableReason,
  whyNot,
  type Space,
} from "../src/index.js";

const base = (extra: Record<string, unknown> = {}): Space =>
  spaceSchema.parse({
    id: "s",
    name: "Test",
    periods: [{ id: "p", name: "P", start: "2026-11-02", end: "2026-11-15" }], // lundi 2 -> dimanche 15
    resources: [
      { id: "a", name: "Ana", skills: ["caisse"] },
      { id: "b", name: "Ben" },
    ],
    needs: [{ id: "m", label: "Matin", skill: "caisse", days: [0, 1, 2, 3, 4], start: "08:00", end: "14:00", required: 1 }],
    ...extra,
  });

describe("calendrier", () => {
  it("développe un besoin récurrent sur la période", () => {
    const occ = periodOccurrences(base(), "p");
    expect(occ).toHaveLength(10);
    expect(occ[0]).toMatchObject({ date: "2026-11-02", start: 32, end: 56, dayIndex: 0 });
  });

  it("saute les fermetures et applique les exceptions et dates ponctuelles", () => {
    const s = base({
      closures: [{ start: "2026-11-11", end: "2026-11-11", label: "Férié" }],
      needs: [{
        id: "m", label: "Matin", days: [0, 1, 2, 3, 4], start: "08:00", end: "14:00", required: 2, extraDates: ["2026-11-14"],
        exceptions: [{ date: "2026-11-03", required: 0 }, { date: "2026-11-04", required: 3 }],
      }],
    });
    const occ = periodOccurrences(s, "p");
    const dates = occ.map((o) => o.date);
    expect(dates).not.toContain("2026-11-11"); // fermeture
    expect(dates).not.toContain("2026-11-03"); // supprimé
    expect(dates).toContain("2026-11-14"); // ponctuel (samedi)
    expect(occ.find((o) => o.date === "2026-11-04")).toMatchObject({ required: 3, max: 3 });
    expect(occ.find((o) => o.date === "2026-11-02")).toMatchObject({ required: 2, max: 2 });
  });

  it("une vacation de nuit se termine le lendemain", () => {
    const s = base({ needs: [{ id: "n", label: "Nuit", days: [0], start: "22:00", end: "06:00" }] });
    const [o] = periodOccurrences(s, "p");
    expect(o).toMatchObject({ start: 88, end: 120 });
  });

  it("propose des périodes entre les vacances", () => {
    const parts = suggestPeriods("2026-09-01", "2026-12-18", [{ start: "2026-10-17", end: "2026-11-01", label: "Toussaint" }], 4);
    expect(parts[0]!.start).toBe("2026-09-01");
    expect(parts.some((p) => p.start <= "2026-10-20" && p.end >= "2026-10-20")).toBe(false);
    expect(parts.at(-1)!.end).toBe("2026-12-18");
  });
});

describe("règles", () => {
  it("détecte absence et horaires non disponibles", () => {
    const s = base({
      resources: [{ id: "a", name: "Ana", absences: [{ start: "2026-11-03", end: "2026-11-04", reason: "congés" }], weekly: [{ days: [0, 1, 2, 3, 4], start: "07:00", end: "13:00" }] }],
    });
    const occ = periodOccurrences(s, "p");
    const r = s.resources[0]!;
    expect(unavailableReason(r, occ.find((o) => o.date === "2026-11-03")!)).toMatch(/congés/);
    expect(unavailableReason(r, occ.find((o) => o.date === "2026-11-05")!)).toMatch(/non disponible/); // finit à 14 h
  });

  it("whyNot signale compétence, repos et plafonds", () => {
    const s = base({
      needs: [
        { id: "m", label: "Matin", skill: "caisse", days: [0, 1], start: "08:00", end: "14:00" },
        { id: "s", label: "Soir", days: [0, 1], start: "18:00", end: "23:00" },
      ],
    });
    const occ = new Map(periodOccurrences(s, "p").map((o) => [o.key, o]));
    const planning = { periodId: "p", assignments: [{ needId: "s", date: "2026-11-02", resourceId: "a", locked: false }], forbidden: [] };
    const ana = s.resources[0]!;
    const ben = s.resources[1]!;
    // Ana a fini à 23 h : le matin suivant (8 h) ne respecte pas 11 h de repos
    expect(whyNot(s, occ, planning, ana, occ.get("m|2026-11-03")!).map((w) => w.kind)).toEqual(["rest"]);
    expect(whyNot(s, occ, planning, ben, occ.get("m|2026-11-03")!).map((w) => w.kind)).toEqual(["skill"]);
    // même jour : 4 h seulement entre 14 h et 18 h, et 11 h de travail au total (plafond de 10 h)
    expect(whyNot(s, occ, planning, ana, occ.get("m|2026-11-02")!).map((w) => w.kind)).toEqual(["rest", "day"]);
  });
});

describe("analyse", () => {
  it("compte la couverture, les heures et signale les violations", () => {
    const s = base({
      resources: [{ id: "a", name: "Ana", skills: ["caisse"], contract: { targetWeekUnits: 80 } }, { id: "b", name: "Ben" }],
      plannings: [{
        periodId: "p",
        assignments: [
          { needId: "m", date: "2026-11-02", resourceId: "a" },
          { needId: "m", date: "2026-11-03", resourceId: "b" }, // pas la compétence
        ],
      }],
    });
    const a = analyzePlanning(s, "p");
    expect(a.missingSeats).toBe(8);
    expect(a.coverage.find((c) => c.date === "2026-11-02")).toMatchObject({ assigned: 1, missing: 0 });
    expect(a.violations.join("\n")).toMatch(/Ben.*compétence/);
    const ana = a.loads.find((l) => l.resourceId === "a")!;
    expect(ana.totalUnits).toBe(24);
    expect(ana.weeks[0]).toMatchObject({ units: 24, target: 80 });
    expect(ana.underTargetUnits).toBe(56 + 80);
  });

  it("proratise la cible des semaines partielles et des absences", () => {
    const s = base({
      resources: [{ id: "a", name: "Ana", skills: ["caisse"], contract: { targetWeekUnits: 140 }, absences: [{ start: "2026-11-09", end: "2026-11-11" }] }],
    });
    const a = analyzePlanning(s, "p");
    const [w1, w2] = a.loads[0]!.weeks;
    expect(w1!.target).toBe(140);
    expect(w2!.target).toBe(80); // 4 jours sur 7
  });
});

describe("fichiers", () => {
  it("aller-retour sans perte", () => {
    const s = base();
    const r = importSpace(exportSpace(s));
    expect(r.ok && r.space).toEqual(s);
  });

  it("refuse les fichiers abîmés ou étrangers avec un message lisible", () => {
    expect(importSpace("{pas du json")).toMatchObject({ ok: false });
    expect(importSpace('{"format":"autre"}')).toMatchObject({ ok: false });
    expect(importSpace(JSON.stringify({ format: "planning-du-goud", version: 99, space: {} }))).toMatchObject({ ok: false });
    const bad = JSON.stringify({ format: "planning-du-goud", version: 1, space: { id: "x", name: "x", needs: [{ id: "n", label: "N", days: [9], start: "08:00", end: "09:00" }] } });
    expect(importSpace(bad)).toMatchObject({ ok: false });
  });

  it("valide les références", () => {
    expect(() => spaceSchema.parse({ id: "s", name: "S", plannings: [{ periodId: "zzz" }] })).toThrow();
    expect(() => base({ needs: [{ id: "m", label: "M", start: "08:00", end: "09:00" }] })).toThrow(/ni jour récurrent/);
    expect(() => base({ needs: [{ id: "m", label: "M", days: [0], start: "08:00", end: "08:00" }] })).toThrow();
  });
});

describe("exports", () => {
  const s = base({
    needs: [{ id: "n", label: "Nuit; \"spéciale\"", days: [0], start: "22:00", end: "06:00" }],
    plannings: [{ periodId: "p", assignments: [{ needId: "n", date: "2026-11-02", resourceId: "a" }] }],
  });
  it("CSV", () => {
    const csv = planningToCsv(s, "p");
    expect(csv.split("\r\n")[0]).toBe("Date;Jour;Début;Fin;Vacation;Compétence;Personne");
    expect(csv).toContain('2026-11-02;Lundi;22:00;06:00;"Nuit; ""spéciale""";;Ana');
  });
  it("ICS", () => {
    const ics = planningToIcs(s, "p", "a");
    expect(ics).toContain("DTSTART:20261102T220000");
    expect(ics).toContain("DTEND:20261103T060000");
    expect(planningToIcs(s, "p", "b")).not.toContain("VEVENT");
  });
});
