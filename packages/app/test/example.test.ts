import { describe, expect, it } from "vitest";
import { diagnosePeriod, solvePeriod } from "@planning/solver";
import { exampleSpace } from "../src/example.js";

describe("exemple", () => {
  it("se calcule sans règle violée ; la semaine de congés de Tom laisse des places vides, expliquées par le diagnostic", async () => {
    const space = exampleSpace();
    const r = await solvePeriod(space, { periodId: "nov", solverOptions: { timeLimitSec: 60, gap: 0.01 } });
    expect(["optimal", "feasible"]).toContain(r.status);
    expect(r.analysis.violations).toEqual([]);
    // seule la semaine du 16 au 20 est en tension
    for (const c of r.analysis.coverage) if (c.missing > 0) expect(c.date >= "2026-11-16" && c.date <= "2026-11-20").toBe(true);
    expect(r.analysis.missingSeats).toBeGreaterThan(0);
    const d = await diagnosePeriod({ ...space, plannings: [r.planning] }, { periodId: "nov", solverOptions: { timeLimitSec: 20 } });
    expect(d.diagnoses.length).toBeGreaterThan(0);
    expect(d.diagnoses.some((x) => x.suggestions.length > 0)).toBe(true);
  }, 180_000);
});
