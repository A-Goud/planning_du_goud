/// <reference lib="webworker" />
import {
  HighsWasmSolver,
  RemoteSolver,
  diagnosePeriod,
  solvePeriod,
  type DiagnoseOptions,
  type DiagnoseResult,
  type SolveOptions,
  type SolveOutcome,
} from "@planning/solver";
import type { Space } from "@planning/core";
import wasmUrl from "highs/runtime?url";

export type WorkerRequest =
  | { kind: "solve"; space: Space; options: Omit<SolveOptions, "solver">; companionUrl?: string }
  | { kind: "diagnose"; space: Space; options: Omit<DiagnoseOptions, "solver">; companionUrl?: string };
export type WorkerResponse = { ok: true; result: SolveOutcome | DiagnoseResult } | { ok: false; error: string };

const browserSolver = new HighsWasmSolver({ locateFile: () => wasmUrl });

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const req = event.data;
    // Compagnon local si demandé, sinon HiGHS dans le navigateur
    const solver = req.companionUrl ? new RemoteSolver(req.companionUrl) : browserSolver;
    const result =
      req.kind === "solve"
        ? await solvePeriod(req.space, { ...req.options, solver })
        : await diagnosePeriod(req.space, { ...req.options, solver });
    self.postMessage({ ok: true, result } satisfies WorkerResponse);
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse);
  }
};
