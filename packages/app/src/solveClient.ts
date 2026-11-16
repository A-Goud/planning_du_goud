import type { Space } from "@planning/core";
import type { DiagnoseOptions, DiagnoseResult, SolveOptions, SolveOutcome } from "@planning/solver";
import type { WorkerRequest, WorkerResponse } from "./solve.worker.js";

export interface Job<T> {
  promise: Promise<T>;
  /** Interrompt le calcul (le worker est détruit). */
  cancel(): void;
}
export type SolveJob = Job<SolveOutcome>;

/** Lance un calcul dans un Web Worker : l'interface reste réactive et le calcul est annulable. */
function startJob<T>(request: WorkerRequest): Job<T> {
  const worker = new Worker(new URL("./solve.worker.ts", import.meta.url), { type: "module" });
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    reject = rej;
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      worker.terminate();
      if (e.data.ok) res(e.data.result as T);
      else rej(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      rej(new Error(e.message || "Erreur dans le calcul."));
    };
  });
  worker.postMessage(request);
  return {
    promise,
    cancel() {
      worker.terminate();
      reject(new Error("Calcul annulé."));
    },
  };
}

/** `companionUrl` : adresse du compagnon local ; sans elle, le calcul se fait dans le navigateur. */
export const startSolve = (space: Space, options: Omit<SolveOptions, "solver">, companionUrl?: string): SolveJob =>
  startJob<SolveOutcome>({ kind: "solve", space, options, companionUrl });

export const startDiagnose = (space: Space, options: Omit<DiagnoseOptions, "solver">, companionUrl?: string): Job<DiagnoseResult> =>
  startJob<DiagnoseResult>({ kind: "diagnose", space, options, companionUrl });
