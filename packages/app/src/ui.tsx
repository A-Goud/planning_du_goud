import type { ReactNode } from "react";
import { UNITS_PER_DAY, formatTime } from "@planning/core";

export const DAY_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
export const DAY_LONG = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

const TIME_OPTIONS = Array.from({ length: UNITS_PER_DAY + 1 }, (_, i) => formatTime(i));

/** Choix d'une heure au quart d'heure. */
export function TimeSelect({ value, onChange, allowEnd = false }: { value: string; onChange(v: string): void; allowEnd?: boolean }) {
  const options = allowEnd ? TIME_OPTIONS : TIME_OPTIONS.slice(0, -1);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  );
}

export function DaysPicker({ value, onChange }: { value: number[]; onChange(v: number[]): void }) {
  return (
    <span className="days">
      {DAY_NAMES.map((name, d) => (
        <label key={d} className={value.includes(d) ? "chip on" : "chip"}>
          <input
            type="checkbox"
            checked={value.includes(d)}
            onChange={(e) => onChange(e.target.checked ? [...value, d].sort() : value.filter((x) => x !== d))}
          />
          {name}
        </label>
      ))}
    </span>
  );
}

export function Errors({ errors }: { errors: string[] | null }) {
  if (!errors || errors.length === 0) return null;
  return (
    <ul className="errors" role="alert">
      {errors.map((e, i) => (
        <li key={i}>{e}</li>
      ))}
    </ul>
  );
}

export function splitList(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

export function formatDuration(units: number): string {
  const minutes = units * 15;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`) : `${m} min`;
}

/** Saisie d'une durée en heures (quarts d'heure permis) ; la valeur est en unités de 15 min. Vide = non précisé. */
export function HoursInput({ value, onChange, placeholder }: { value: number | undefined; onChange(v: number | undefined): void; placeholder?: string }) {
  return (
    <input
      type="number"
      min={0}
      step={0.25}
      placeholder={placeholder}
      value={value === undefined ? "" : value / 4}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value) * 4)))}
    />
  );
}

/** « 02/11 » à partir de « 2026-11-02 ». */
export const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** Couleur pastel stable pour un besoin (par son rang). */
export const needColor = (index: number) => `hsl(${(index * 67 + 200) % 360} 65% 82%)`;
