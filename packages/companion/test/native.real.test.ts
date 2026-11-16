import { describe, expect, it } from "vitest";
import { spaceSchema } from "@planning/core";
import { HighsWasmSolver, buildProblem } from "@planning/solver";
import { findNativeHighs, nativeEngine } from "../src/native.js";

/**
 * Compare HiGHS natif et HiGHS WebAssembly sur de vrais problèmes.
 * S'exécute seulement si HIGHS_BIN pointe vers un exécutable HiGHS (sinon ignoré).
 */
const bin = process.env.HIGHS_BIN ? findNativeHighs(process.env.HIGHS_BIN) : null;

function instance() {
  let seed = 99;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const skills = ["caisse", "stock", "accueil"];
  return spaceSchema.parse({
    id: "s", name: "Réel",
    periods: [{ id: "p", name: "P", start: "2026-11-02", end: "2026-11-29" }],
    resources: Array.from({ length: 20 }, (_, i) => ({
      id: "r" + i, name: "Personne " + i, skills: [skills[i % 3], skills[(i + 1) % 3]],
      contract: { targetWeekUnits: 80 + 20 * Math.floor(rnd() * 4) },
    })),
    needs: Array.from({ length: 8 }, (_, i) => ({
      id: "n" + i, label: "Besoin " + i, skill: skills[i % 3], days: [0, 1, 2, 3, 4, 5], start: i % 2 ? "13:00" : "07:00", end: i % 2 ? "20:00" : "14:00",
      required: 1 + Math.floor(rnd() * 2), priority: 1 + Math.floor(rnd() * 5), unpopular: i === 7,
    })),
    plannings: [],
  });
}

describe.skipIf(!bin)("HiGHS natif (exécutable réel)", () => {
  it("trouve le même optimum que le WebAssembly", async () => {
    const problem = buildProblem(instance(), { periodId: "p" });
    const options = { timeLimitSec: 60, gap: 0 };
    const wasm = await new HighsWasmSolver().solve(problem.model, options);
    const native = await nativeEngine(bin!).solve(problem.model, options, new AbortController().signal);
    expect(native.status).toBe("optimal");
    expect(wasm.status).toBe("optimal");
    expect(native.objective).toBeCloseTo(wasm.objective, 3);
    expect(native.values).toHaveLength(problem.model.variableCount);
  });
  it("s'arrête quand on annule", async () => {
    const ctl = new AbortController();
    const problem = buildProblem(instance(), { periodId: "p" });
    const run = nativeEngine(bin!).solve(problem.model, { timeLimitSec: 120, gap: 0 }, ctl.signal);
    ctl.abort();
    await expect(run).rejects.toBeDefined();
  });
});
