import { describe, expect, it } from "vitest";
import { spaceSchema, type Space } from "@planning/core";
import { applyPatch, diagnosePeriod, estimateVariables, solvePeriod, type SolveOutcome } from "../src/index.js";

type Input = Parameters<typeof spaceSchema.parse>[0];

/** Période du lundi 2 au dimanche 15 novembre 2026 (deux semaines pleines). */
function space(partial: { resources: unknown[]; needs: unknown[]; plannings?: unknown[]; rules?: unknown; closures?: unknown[]; end?: string }): Space {
  const { end, ...rest } = partial;
  return spaceSchema.parse({
    id: "s",
    name: "Test",
    periods: [{ id: "p", name: "P", start: "2026-11-02", end: end ?? "2026-11-15" }],
    plannings: [],
    ...rest,
  } as Input);
}

const person = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), ...extra });
const need = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, days: [0, 1, 2, 3, 4], start: "08:00", end: "14:00", ...extra });

const solve = (s: Space, extra: Record<string, unknown> = {}) => solvePeriod(s, { periodId: "p", solverOptions: { timeLimitSec: 30, gap: 0 }, ...extra });
const who = (r: SolveOutcome, needId: string, date?: string) =>
  r.planning.assignments.filter((a) => a.needId === needId && (!date || a.date === date)).map((a) => a.resourceId).sort();
const count = (r: SolveOutcome, resourceId: string) => r.planning.assignments.filter((a) => a.resourceId === resourceId).length;

describe("couverture", () => {
  it("pourvoit tous les besoins sans violer aucune règle", async () => {
    const s = space({ resources: [person("a"), person("b"), person("c")], needs: [need("m", { required: 2 })] });
    const r = await solve(s);
    expect(r.status).toBe("optimal");
    expect(r.analysis.missingSeats).toBe(0);
    expect(r.analysis.violations).toEqual([]);
    expect(r.planning.assignments).toHaveLength(20);
  });

  it("ne répond jamais « impossible » : les places manquantes sont signalées", async () => {
    const s = space({ resources: [person("a")], needs: [need("m", { required: 2 })] });
    const r = await solve(s);
    expect(r.status).toBe("optimal");
    expect(r.analysis.missingSeats).toBe(10);
    expect(count(r, "a")).toBe(10);
  });

  it("respecte la compétence exigée", async () => {
    const s = space({ resources: [person("a", { skills: ["caisse"] }), person("b")], needs: [need("m", { skill: "caisse" })] });
    const r = await solve(s);
    expect(who(r, "m")).toEqual(Array(10).fill("a"));
  });

  it("signale un besoin que personne ne peut pourvoir", async () => {
    const s = space({ resources: [person("a")], needs: [need("m", { skill: "soudure" })] });
    const r = await solve(s);
    expect(r.planning.assignments).toHaveLength(0);
    expect(r.warnings.join(" ")).toMatch(/Personne ne peut pourvoir/);
  });

  it("préfère le besoin le plus prioritaire quand une personne ne peut pas tout faire", async () => {
    const s = space({ resources: [person("a")], needs: [need("bas", { priority: 1 }), need("haut", { priority: 5 })] });
    const r = await solve(s);
    expect(who(r, "haut")).toHaveLength(10);
    expect(who(r, "bas")).toHaveLength(0);
  });

  it("laisse les jours de fermeture sans besoin", async () => {
    const s = space({ resources: [person("a")], needs: [need("m")], closures: [{ start: "2026-11-11", end: "2026-11-11", label: "Férié" }] });
    const r = await solve(s);
    expect(r.analysis.coverage).toHaveLength(9);
    expect(r.analysis.missingSeats).toBe(0);
  });
});

describe("disponibilités", () => {
  it("n'affecte pas une personne absente ou hors de ses horaires", async () => {
    const s = space({
      resources: [
        person("a", { absences: [{ start: "2026-11-03", end: "2026-11-04" }] }),
        person("b", { weekly: [{ days: [0, 1, 2, 3, 4], start: "08:00", end: "14:00" }] }),
        person("c", { weekly: [{ days: [0, 1, 2, 3, 4], start: "14:00", end: "20:00" }] }), // jamais dispo le matin
      ],
      needs: [need("m")],
    });
    const r = await solve(s);
    expect(r.analysis.violations).toEqual([]);
    expect(who(r, "m", "2026-11-03")).toEqual(["b"]);
    expect(count(r, "c")).toBe(0);
  });

  it("honore les interdictions et les verrous", async () => {
    const s = space({
      resources: [person("a"), person("b")],
      needs: [need("m")],
      plannings: [{
        periodId: "p",
        assignments: [{ needId: "m", date: "2026-11-02", resourceId: "b", locked: true }],
        forbidden: [{ resourceId: "a", date: "2026-11-03" }],
      }],
    });
    const r = await solve(s);
    expect(who(r, "m", "2026-11-02")).toEqual(["b"]);
    expect(r.planning.assignments.find((x) => x.date === "2026-11-02")!.locked).toBe(true);
    expect(who(r, "m", "2026-11-03")).toEqual(["b"]);
    expect(r.planning.forbidden).toHaveLength(1);
  });

  it("signale un verrou impossible à respecter", async () => {
    const s = space({
      resources: [person("a", { absences: [{ start: "2026-11-02", end: "2026-11-02" }] })],
      needs: [need("m")],
      plannings: [{ periodId: "p", assignments: [{ needId: "m", date: "2026-11-02", resourceId: "a", locked: true }] }],
    });
    const r = await solve(s);
    expect(r.warnings.join(" ")).toMatch(/verrouillée impossible/);
  });
});

describe("règles du travail", () => {
  it("respecte le repos minimal, y compris après une vacation de nuit", async () => {
    const s = space({
      resources: [person("a"), person("b"), person("c")],
      needs: [
        need("nuit", { days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "06:00" }),
        need("matin", { days: [0, 1, 2, 3, 4, 5, 6], start: "07:00", end: "13:00" }),
      ],
      end: "2026-11-05",
    });
    const r = await solve(s);
    // la nuit finit à 6 h : impossible d'enchaîner le matin à 7 h avec 11 h de repos
    expect(r.analysis.violations).toEqual([]);
    expect(r.analysis.missingSeats).toBe(0);
    for (const d of ["2026-11-03", "2026-11-04", "2026-11-05"]) {
      expect(who(r, "nuit", d)[0]).not.toBe(who(r, "matin", d)[0]);
    }
  });

  it("respecte le plafond hebdomadaire", async () => {
    const s = space({
      resources: [person("a", { contract: { maxWeekUnits: 80 } }), person("b")], // 20 h : trois vacations de 6 h au plus
      needs: [need("m")],
    });
    const r = await solve(s);
    expect(r.analysis.violations).toEqual([]);
    expect(r.analysis.missingSeats).toBe(0);
    const ana = r.analysis.loads.find((l) => l.resourceId === "a")!;
    expect(Math.max(...ana.weeks.map((w) => w.units))).toBeLessThanOrEqual(80);
  });

  it("limite les jours de travail d'affilée", async () => {
    const s = space({
      resources: [person("a"), person("b")],
      needs: [need("m", { days: [0, 1, 2, 3, 4, 5, 6] })],
      rules: { maxConsecutiveDays: 3 },
    });
    const r = await solve(s);
    expect(r.analysis.violations).toEqual([]);
    expect(r.analysis.missingSeats).toBe(0);
  });

  it("limite la durée par jour", async () => {
    const s = space({
      resources: [person("a", { contract: { minRestUnits: 0 } })],
      needs: [need("m1", { start: "06:00", end: "12:00" }), need("m2", { start: "12:00", end: "18:00" })], // 12 h > plafond de 10 h
      end: "2026-11-02",
    });
    const r = await solve(s);
    expect(r.analysis.violations).toEqual([]);
    expect(r.analysis.missingSeats).toBe(1);
  });
});

describe("occupation et équité", () => {
  it("vise la durée hebdomadaire du contrat quand l'effectif maximal le permet", async () => {
    const s = space({
      resources: [person("a", { contract: { targetWeekUnits: 120 } }), person("b", { contract: { targetWeekUnits: 120 } })], // 30 h chacun
      needs: [need("m", { max: 2 })], // 5 × 6 h = 30 h par semaine et par place
    });
    const r = await solve(s);
    for (const l of r.analysis.loads) expect(l.weeks.map((w) => w.units)).toEqual([120, 120]);
    expect(r.analysis.underTargetUnits).toBe(0);
  });

  it("sans effectif maximal, n'ajoute pas de personnes au-delà du besoin", async () => {
    const s = space({
      resources: [person("a", { contract: { targetWeekUnits: 120 } }), person("b", { contract: { targetWeekUnits: 120 } })],
      needs: [need("m")],
    });
    const r = await solve(s);
    expect(r.planning.assignments).toHaveLength(10);
    expect(r.analysis.underTargetUnits).toBe(240);
  });

  it("répartit équitablement les vacations pénibles", async () => {
    const s = space({
      resources: [person("a"), person("b")],
      needs: [need("we", { days: [5, 6], unpopular: true, start: "09:00", end: "13:00" })],
      end: "2026-11-15",
    });
    const r = await solve(s);
    // quatre vacations pénibles (2 week-ends × 2 jours), deux personnes
    expect(count(r, "a")).toBe(2);
    expect(count(r, "b")).toBe(2);
  });

  it("tient compte des souhaits de jour libre quand c'est possible", async () => {
    const s = space({
      resources: [person("a", { preferences: { offDates: ["2026-11-02"] } }), person("b")],
      needs: [need("m")],
      end: "2026-11-02",
    });
    const r = await solve(s);
    expect(who(r, "m")).toEqual(["b"]);
  });

  it("garde le planning de référence quand plusieurs solutions se valent", async () => {
    const s = space({ resources: [person("a"), person("b")], needs: [need("m")], end: "2026-11-06" });
    const ref = { periodId: "p", forbidden: [], assignments: ["a", "b", "b", "a", "b"].map((r, i) => ({ needId: "m", date: `2026-11-0${2 + i}`, resourceId: r, locked: false })) };
    const r = await solve(s, { reference: ref });
    expect(r.planning.assignments.map((a) => `${a.date}${a.resourceId}`).sort()).toEqual(ref.assignments.map((a) => `${a.date}${a.resourceId}`).sort());
  });

  it("complète sans toucher à l'existant en mode figé", async () => {
    const s = space({
      resources: [person("a"), person("b")],
      needs: [need("m", { required: 2 })],
      end: "2026-11-03",
      plannings: [{ periodId: "p", assignments: [{ needId: "m", date: "2026-11-02", resourceId: "a" }] }],
    });
    const r = await solve(s, { freezeExisting: true });
    expect(who(r, "m", "2026-11-02")).toEqual(["a", "b"]);
    expect(r.planning.assignments.find((x) => x.resourceId === "a" && x.date === "2026-11-02")).toBeTruthy();
  });
});

describe("diagnostic", () => {
  it("explique une place vide et teste ce qui la débloquerait", async () => {
    const s = space({
      resources: [person("a", { skills: ["caisse"], absences: [{ start: "2026-11-03", end: "2026-11-03", reason: "congés" }] }), person("b"), person("c", { skills: ["caisse"], weekly: [{ days: [0, 2, 3, 4], start: "08:00", end: "14:00" }] })],
      needs: [need("m", { skill: "caisse" })],
      end: "2026-11-06",
    });
    const r = await solve(s);
    // le mardi 3 : A est en congé, C ne travaille pas le mardi, B n'a pas la compétence
    expect(r.analysis.missingSeats).toBe(1);
    const planned: Space = { ...s, plannings: [r.planning] };
    const d = await diagnosePeriod(planned, { periodId: "p", solverOptions: { timeLimitSec: 20 } });
    expect(d.diagnoses).toHaveLength(1);
    const diag = d.diagnoses[0]!;
    expect(diag.missing).toEqual([{ date: "2026-11-03", missing: 1 }]);
    expect(diag.causes.join(" ")).toMatch(/congés/);
    expect(diag.causes.join(" ")).toMatch(/non disponible le mardi/);
    const kinds = diag.suggestions.map((x) => x.patch.type).sort();
    expect(kinds).toEqual(["addSkill", "clearAvailability"]);
    expect(diag.suggestions.every((x) => x.missingAfter === 0)).toBe(true);

    // appliquer une suggestion débouche bien sur un planning complet
    const fix = diag.suggestions.find((x) => x.patch.type === "addSkill")!.patch;
    const r2 = await solve(applyPatch(s, "p", fix));
    expect(r2.analysis.missingSeats).toBe(0);
  });

  it("ne trouve rien à diagnostiquer quand tout est pourvu", async () => {
    const s = space({ resources: [person("a")], needs: [need("m")], end: "2026-11-02" });
    const r = await solve(s);
    const d = await diagnosePeriod({ ...s, plannings: [r.planning] }, { periodId: "p" });
    expect(d.diagnoses).toEqual([]);
  });
});

describe("taille du problème", () => {
  it("estime le nombre de variables", () => {
    const s = space({ resources: [person("a", { skills: ["x"] }), person("b")], needs: [need("m", { skill: "x" })] });
    expect(estimateVariables(s, "p")).toBe(10);
  });

  it("résout une équipe de taille réelle en quelques secondes", async () => {
    const resources = Array.from({ length: 24 }, (_, i) =>
      person(`p${i}`, { skills: i % 3 === 0 ? ["caisse", "stock"] : i % 3 === 1 ? ["caisse"] : ["stock"], contract: { targetWeekUnits: i % 4 === 0 ? 80 : 140 } }),
    );
    const s = space({
      resources,
      needs: [
        need("matin", { days: [0, 1, 2, 3, 4, 5], start: "07:00", end: "14:00", skill: "caisse", required: 3 }),
        need("soir", { days: [0, 1, 2, 3, 4, 5], start: "13:00", end: "20:00", skill: "caisse", required: 3 }),
        need("stock", { days: [0, 1, 2, 3, 4, 5, 6], start: "06:00", end: "12:00", skill: "stock", required: 2 }),
        need("dim", { days: [6], start: "09:00", end: "13:00", skill: "caisse", required: 2, unpopular: true }),
      ],
      end: "2026-11-29", // 4 semaines
    });
    const r = await solvePeriod(s, { periodId: "p", solverOptions: { timeLimitSec: 60, gap: 0.01 } });
    expect(["optimal", "feasible"]).toContain(r.status);
    expect(r.analysis.violations).toEqual([]);
    expect(r.analysis.missingSeats).toBe(0);
    console.log(`taille réelle : ${r.stats.variables} variables, ${r.stats.rows} lignes, ${r.stats.millis} ms (${r.status})`);
  }, 90_000);
});
