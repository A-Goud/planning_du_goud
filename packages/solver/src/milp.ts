/**
 * Modèle d'optimisation linéaire en nombres entiers, indépendant du moteur.
 * Le même modèle peut être résolu par HiGHS (navigateur ou compagnon).
 */

export type Term = readonly [variable: number, coefficient: number];
export type Sense = "<=" | ">=" | "=";

export interface Row {
  name: string;
  terms: Term[];
  sense: Sense;
  rhs: number;
}

/** Le modèle sous forme de données (JSON), échangé avec le compagnon. */
export interface MilpModelData {
  /** Pour chaque variable : null = binaire, nombre = continue bornée dans [0, borne]. */
  bounds: (number | null)[];
  objective: [number, number][];
  rows: Row[];
}

export class MilpModel {
  /** Pour chaque variable : null = binaire, nombre = continue bornée dans [0, borne]. */
  private bounds: (number | null)[] = [];
  private objective = new Map<number, number>();
  readonly rows: Row[] = [];

  get variableCount(): number {
    return this.bounds.length;
  }

  addBinary(): number {
    this.bounds.push(null);
    return this.bounds.length - 1;
  }

  addContinuous(upper: number): number {
    this.bounds.push(upper);
    return this.bounds.length - 1;
  }

  /** Ajoute `coefficient` au coefficient de la variable dans l'objectif (maximisation). */
  addObjective(variable: number, coefficient: number): void {
    this.objective.set(variable, (this.objective.get(variable) ?? 0) + coefficient);
  }

  addRow(terms: Term[], sense: Sense, rhs: number): void {
    this.rows.push({ name: `r${this.rows.length}`, terms, sense, rhs });
  }

  toData(): MilpModelData {
    return { bounds: [...this.bounds], objective: [...this.objective], rows: this.rows.map((r) => ({ ...r, terms: [...r.terms] })) };
  }

  static fromData(data: MilpModelData): MilpModel {
    const m = new MilpModel();
    m.bounds = [...data.bounds];
    for (const [v, c] of data.objective) m.objective.set(v, c);
    m.rows.push(...data.rows);
    return m;
  }

  /** Format LP, lu par HiGHS. Les variables sont nommées v0, v1, ... */
  toLP(): string {
    const lines: string[] = ["Maximize"];
    const objTerms = [...this.objective].filter(([, c]) => c !== 0);
    lines.push(" obj: " + (objTerms.length ? formatTerms(objTerms) : `0 v0`));
    lines.push("Subject To");
    for (const r of this.rows) {
      lines.push(` ${r.name}: ${formatTerms(r.terms)} ${r.sense} ${r.rhs}`);
    }
    const continuous: string[] = [];
    const binary: string[] = [];
    this.bounds.forEach((b, i) => {
      if (b === null) binary.push(`v${i}`);
      else continuous.push(` 0 <= v${i} <= ${b}`);
    });
    if (continuous.length) lines.push("Bounds", ...continuous);
    if (binary.length) lines.push("Binary", " " + binary.join(" "));
    lines.push("End");
    return lines.join("\n");
  }
}

function formatTerms(terms: readonly Term[]): string {
  let out = "";
  terms.forEach(([v, c], i) => {
    const sign = c < 0 ? "-" : i === 0 ? "" : "+";
    const abs = Math.abs(c);
    out += (i === 0 ? sign : ` ${sign} `) + (abs === 1 ? "" : `${abs} `) + `v${v}`;
  });
  return out;
}

export type SolveStatus = "optimal" | "feasible" | "infeasible" | "unbounded" | "error";

export interface MilpSolution {
  status: SolveStatus;
  /** Vrai si la limite de temps a interrompu la recherche. */
  timeLimitReached: boolean;
  objective: number;
  /** Valeur de chaque variable, dans l'ordre des indices. */
  values: number[];
  millis: number;
}

export interface SolverOptions {
  timeLimitSec?: number;
  /** Écart relatif toléré à l'optimum (par exemple 0.01 = 1 %). */
  gap?: number;
}

/** Un moteur de résolution. Implémentations : HiGHS WebAssembly, HiGHS natif (compagnon). */
export interface MilpSolver {
  solve(model: MilpModel, options?: SolverOptions): Promise<MilpSolution>;
}
