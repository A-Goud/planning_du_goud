import { z } from "zod";
import { isValidDate, parseEndTime, parseTime } from "./time.js";

// ---------------------------------------------------------------- briques

const id = z.string().min(1);
const name = z.string().trim().min(1);
const date = z.string().refine(isValidDate, "date invalide (attendu AAAA-MM-JJ)");

const startTime = z.string().refine(
  (s) => {
    try { parseTime(s); return true; } catch { return false; }
  },
  "heure invalide (HH:MM, multiple de 15 min)",
);
const endTime = z.string().refine(
  (s) => {
    try { parseEndTime(s); return true; } catch { return false; }
  },
  "heure invalide (HH:MM, multiple de 15 min, ou 24:00)",
);

/** Jour de la semaine : 0 = lundi ... 6 = dimanche. */
const weekday = z.number().int().min(0).max(6);

function endAfterStart(r: { start: string; end: string }): boolean {
  try {
    return parseEndTime(r.end) > parseTime(r.start);
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------- ressources (les personnes à occuper)

/** Fenêtre de disponibilité hebdomadaire : la personne peut travailler ces jours-là, entre ces heures. */
export const availabilityRuleSchema = z
  .object({ days: z.array(weekday).min(1), start: startTime, end: endTime })
  .refine(endAfterStart, "la fin doit suivre le début");

/** Absence sur des jours entiers (congés, maladie, formation…). */
export const absenceSchema = z
  .object({ start: date, end: date, reason: z.string().optional() })
  .refine((a) => a.end >= a.start, "la fin doit suivre le début");

/**
 * Cadre de travail d'une personne. Tout est facultatif : ce qui n'est pas précisé
 * vient des règles par défaut de l'espace (`rules`).
 */
export const contractSchema = z.object({
  /** Durée hebdomadaire visée (souple : le calcul cherche à l'atteindre, sans jamais en faire une obligation). */
  targetWeekUnits: z.number().int().positive().optional(),
  /** Plafond hebdomadaire (dur). */
  maxWeekUnits: z.number().int().positive().optional(),
  /** Plafond journalier (dur). */
  maxDayUnits: z.number().int().positive().optional(),
  /** Nombre maximal de jours de travail d'affilée (dur). */
  maxConsecutiveDays: z.number().int().min(1).max(14).optional(),
  /** Repos minimal entre la fin d'une vacation et le début de la suivante (dur). */
  minRestUnits: z.number().int().min(0).optional(),
});

/** Souhaits de la personne (souples). */
export const preferencesSchema = z.object({
  preferDays: z.array(weekday).default([]),
  avoidDays: z.array(weekday).default([]),
  preferNeedIds: z.array(id).default([]),
  avoidNeedIds: z.array(id).default([]),
  /** Jours où la personne souhaite ne pas travailler (souhait, pas absence). */
  offDates: z.array(date).default([]),
});

export const resourceSchema = z.object({
  id,
  name,
  /** Compétences / qualifications (« caisse », « cuisine », « infirmier »…). */
  skills: z.array(name).default([]),
  /** Disponibilités hebdomadaires. Vide = disponible à toute heure. */
  weekly: z.array(availabilityRuleSchema).default([]),
  absences: z.array(absenceSchema).default([]),
  contract: contractSchema.prefault({}),
  preferences: preferencesSchema.prefault({}),
});

// ---------------------------------------------------------------- besoins (ce qu'il faut couvrir)

/** Modification d'un jour précis : effectif différent, ou 0 pour supprimer la vacation ce jour-là. */
export const needExceptionSchema = z.object({
  date,
  required: z.number().int().min(0),
  reason: z.string().optional(),
});

/**
 * Un besoin est une vacation récurrente à pourvoir : « Caisse, du lundi au samedi de 8 h à 14 h, 2 personnes ».
 * Une heure de fin inférieure ou égale au début signifie que la vacation se termine le lendemain (équipe de nuit).
 */
export const needSchema = z
  .object({
    id,
    label: name,
    /** Compétence exigée. Absente = toute personne convient. */
    skill: name.optional(),
    days: z.array(weekday).default([]),
    /** Dates ponctuelles en plus des jours récurrents (événement, ouverture exceptionnelle). */
    extraDates: z.array(date).default([]),
    start: startTime,
    end: endTime,
    /** Effectif à pourvoir. */
    required: z.number().int().positive().default(1),
    /** Effectif maximal accepté (défaut : l'effectif requis). Au-dessus du requis, ça sert à occuper les personnes sous-employées. */
    max: z.number().int().positive().optional(),
    /** Importance de pourvoir ce besoin : 1 (basse) à 5 (haute). */
    priority: z.number().int().min(1).max(5).default(3),
    /** Vacation pénible (week-end, nuit, férié…) : sa charge est répartie équitablement. */
    unpopular: z.boolean().default(false),
    exceptions: z.array(needExceptionSchema).default([]),
    /** Périodes concernées. Vide = toutes. */
    periodIds: z.array(id).default([]),
  })
  .refine((n) => {
    try { return parseEndTime(n.end) !== parseTime(n.start); } catch { return true; }
  }, "la vacation ne peut pas être de durée nulle")
  .refine((n) => n.max === undefined || n.max >= n.required, "l'effectif maximal ne peut pas être inférieur à l'effectif requis");

// ---------------------------------------------------------------- calendrier

export const periodSchema = z
  .object({ id, name, start: date, end: date })
  .refine((p) => p.end >= p.start, "la fin doit suivre le début");

/** Jours sans besoin (jours fériés, fermeture de l'établissement). */
export const closureSchema = z
  .object({ start: date, end: date, label: name })
  .refine((c) => c.end >= c.start, "la fin doit suivre le début");

// ---------------------------------------------------------------- plannings

/** Une personne placée sur une vacation d'un jour précis. */
export const assignmentSchema = z.object({
  needId: id,
  date,
  resourceId: id,
  locked: z.boolean().default(false),
});

/** Interdiction posée par l'utilisateur : cette personne ne doit pas être placée là (ou ce jour-là, si le besoin est omis). */
export const forbiddenSchema = z.object({
  resourceId: id,
  date,
  needId: id.optional(),
  reason: z.string().optional(),
});

export const planningSchema = z.object({
  periodId: id,
  assignments: z.array(assignmentSchema).default([]),
  forbidden: z.array(forbiddenSchema).default([]),
});

// ---------------------------------------------------------------- règles par défaut

/** Règles qui valent pour tout le monde, sauf précision dans le cadre de travail d'une personne. À adapter à votre convention. */
export const rulesSchema = z.object({
  /** Repos minimal entre deux vacations (défaut : 11 h). */
  minRestUnits: z.number().int().min(0).default(44),
  /** Jours de travail d'affilée au plus (défaut : 6). */
  maxConsecutiveDays: z.number().int().min(1).max(14).default(6),
  /** Durée maximale par jour (défaut : 10 h). */
  maxDayUnits: z.number().int().positive().default(40),
  /** Durée maximale par semaine (défaut : 48 h). */
  maxWeekUnits: z.number().int().positive().default(192),
});

// ---------------------------------------------------------------- espace

export const spaceSchema = z
  .object({
    id,
    name,
    resources: z.array(resourceSchema).default([]),
    needs: z.array(needSchema).default([]),
    periods: z.array(periodSchema).default([]),
    closures: z.array(closureSchema).default([]),
    plannings: z.array(planningSchema).default([]),
    rules: rulesSchema.prefault({}),
  })
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    const unique = (label: string, key: "resources" | "needs" | "periods", ids: string[]) => {
      const seen = new Set<string>();
      ids.forEach((v, i) => {
        if (seen.has(v)) issue([key, i, "id"], `${label} en double : « ${v} »`);
        seen.add(v);
      });
    };
    unique("ressource", "resources", s.resources.map((r) => r.id));
    unique("besoin", "needs", s.needs.map((n) => n.id));
    unique("période", "periods", s.periods.map((p) => p.id));

    const resourceIds = new Set(s.resources.map((r) => r.id));
    const needIds = new Set(s.needs.map((n) => n.id));
    const periodIds = new Set(s.periods.map((p) => p.id));

    s.resources.forEach((r, i) => {
      for (const key of ["preferNeedIds", "avoidNeedIds"] as const) {
        r.preferences[key].forEach((nid) => {
          if (!needIds.has(nid)) issue(["resources", i, "preferences", key], `besoin inconnu : « ${nid} »`);
        });
      }
    });

    s.needs.forEach((n, i) => {
      n.periodIds.forEach((pid) => {
        if (!periodIds.has(pid)) issue(["needs", i, "periodIds"], `période inconnue : « ${pid} »`);
      });
      if (n.days.length === 0 && n.extraDates.length === 0) {
        issue(["needs", i, "days"], "le besoin n'a ni jour récurrent ni date ponctuelle");
      }
    });

    const sortedPeriods = [...s.periods].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < sortedPeriods.length; i++) {
      const prev = sortedPeriods[i - 1]!;
      const cur = sortedPeriods[i]!;
      if (cur.start <= prev.end) {
        issue(["periods"], `les périodes « ${prev.name} » et « ${cur.name} » se chevauchent`);
      }
    }

    s.plannings.forEach((p, i) => {
      if (!periodIds.has(p.periodId)) issue(["plannings", i, "periodId"], `période inconnue : « ${p.periodId} »`);
      p.assignments.forEach((a, j) => {
        if (!needIds.has(a.needId)) issue(["plannings", i, "assignments", j], `besoin inconnu : « ${a.needId} »`);
        if (!resourceIds.has(a.resourceId)) issue(["plannings", i, "assignments", j], `ressource inconnue : « ${a.resourceId} »`);
      });
      p.forbidden.forEach((f, j) => {
        if (!resourceIds.has(f.resourceId)) issue(["plannings", i, "forbidden", j], `ressource inconnue : « ${f.resourceId} »`);
        if (f.needId !== undefined && !needIds.has(f.needId)) issue(["plannings", i, "forbidden", j], `besoin inconnu : « ${f.needId} »`);
      });
    });
  });

export type AvailabilityRule = z.infer<typeof availabilityRuleSchema>;
export type Absence = z.infer<typeof absenceSchema>;
export type Contract = z.infer<typeof contractSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type Resource = z.infer<typeof resourceSchema>;
export type Need = z.infer<typeof needSchema>;
export type NeedException = z.infer<typeof needExceptionSchema>;
export type Period = z.infer<typeof periodSchema>;
export type Closure = z.infer<typeof closureSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
export type Forbidden = z.infer<typeof forbiddenSchema>;
export type Planning = z.infer<typeof planningSchema>;
export type Rules = z.infer<typeof rulesSchema>;
export type Space = z.infer<typeof spaceSchema>;
