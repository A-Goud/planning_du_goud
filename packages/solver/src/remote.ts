import { MilpModel, type MilpSolution, type MilpSolver, type SolverOptions } from "./milp.js";

export const DEFAULT_COMPANION_URL = "http://127.0.0.1:47822";
export const COMPANION_PROTOCOL = 1;

export interface CompanionInfo {
  name: "planning-companion";
  protocol: number;
  version: string;
  /** Moteur utilisé : HiGHS natif ou HiGHS WebAssembly exécuté hors du navigateur. */
  engine: "native" | "wasm";
}

/** Cherche un compagnon à l'adresse donnée. Renvoie null s'il est absent, refusé ou incompatible. */
export async function detectCompanion(baseUrl: string = DEFAULT_COMPANION_URL, timeoutMs = 1500): Promise<CompanionInfo | null> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const info = (await res.json()) as CompanionInfo;
    return info.name === "planning-companion" && info.protocol === COMPANION_PROTOCOL ? info : null;
  } catch {
    return null;
  }
}

/** Résout le modèle sur le compagnon local. Annuler = interrompre la requête (le compagnon arrête alors son calcul). */
export class RemoteSolver implements MilpSolver {
  constructor(private readonly baseUrl: string = DEFAULT_COMPANION_URL) {}

  async solve(model: MilpModel, options: SolverOptions = {}): Promise<MilpSolution> {
    if (model.variableCount === 0) return { status: "optimal", timeLimitReached: false, objective: 0, values: [], millis: 0 };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/solve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protocol: COMPANION_PROTOCOL, model: model.toData(), options }),
      });
    } catch {
      throw new Error("Le compagnon ne répond pas. Vérifiez qu'il est lancé, ou choisissez le solveur du navigateur.");
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Le compagnon a refusé le calcul (${res.status}) ${detail}`.trim());
    }
    return (await res.json()) as MilpSolution;
  }
}
