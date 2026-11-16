/** Unité de temps interne : 15 minutes. Une journée compte 96 unités. */
export const MINUTES_PER_UNIT = 15;
export const UNITS_PER_DAY = 96;
export const DAYS_PER_WEEK = 7;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "18:30" -> 74. Lève une erreur si l'heure n'est pas un multiple de 15 min. */
export function parseTime(text: string): number {
  const m = HHMM.exec(text);
  if (!m) throw new Error(`Heure invalide : « ${text} » (attendu HH:MM)`);
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (minutes % MINUTES_PER_UNIT !== 0) {
    throw new Error(`Heure « ${text} » : seuls les multiples de 15 minutes sont permis`);
  }
  return minutes / MINUTES_PER_UNIT;
}

/** 74 -> "18:30". 96 (fin de journée) -> "24:00". */
export function formatTime(units: number): string {
  const minutes = units * MINUTES_PER_UNIT;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Une heure de fin peut valoir "24:00" ; toute autre heure doit être valide. */
export function parseEndTime(text: string): number {
  return text === "24:00" ? UNITS_PER_DAY : parseTime(text);
}

/** Indique si la chaîne est une date ISO réelle (YYYY-MM-DD). */
export function isValidDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** Jour de la semaine : 0 = lundi ... 6 = dimanche. */
export function weekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = dimanche
  return (d + 6) % 7;
}
