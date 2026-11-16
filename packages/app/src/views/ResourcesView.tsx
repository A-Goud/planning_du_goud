import { useState } from "react";
import { formatHours, resourceSchema, type Resource } from "@planning/core";
import { newId, upsert, useStore } from "../store.js";
import { DAY_NAMES, DaysPicker, Errors, Field, HoursInput, TimeSelect, splitList } from "../ui.js";

function blank(): Resource {
  return resourceSchema.parse({ id: newId("r"), name: "" });
}

function summary(r: Resource): string {
  return r.weekly.map((w) => `${w.days.map((d) => DAY_NAMES[d]).join(" ")} ${w.start}–${w.end}`).join(" · ") || "toujours disponible";
}

export function ResourcesView() {
  const { space, commit } = useStore();
  const [draft, setDraft] = useState<Resource | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [rulesErrors, setRulesErrors] = useState<string[] | null>(null);
  const allSkills = [...new Set([...space.resources.flatMap((r) => r.skills), ...space.needs.flatMap((n) => (n.skill ? [n.skill] : []))])].sort();

  const save = () => {
    if (!draft) return;
    const result = commit({ ...space, resources: upsert(space.resources, draft) });
    setErrors(result);
    if (!result) setDraft(null);
  };
  const remove = (id: string) => setErrors(commit({ ...space, resources: space.resources.filter((r) => r.id !== id) }));
  const setRule = (patch: Partial<typeof space.rules>) => setRulesErrors(commit({ ...space, rules: { ...space.rules, ...patch } }));
  const setContract = (patch: Partial<Resource["contract"]>) => draft && setDraft({ ...draft, contract: { ...draft.contract, ...patch } });
  const setPrefs = (patch: Partial<Resource["preferences"]>) => draft && setDraft({ ...draft, preferences: { ...draft.preferences, ...patch } });

  return (
    <section>
      <div className="toolbar">
        <h2>Ressources</h2>
        <button className="primary" onClick={() => { setDraft(blank()); setErrors(null); }}>Ajouter une ressource</button>
      </div>
      <p className="hint">Les personnes à placer. Chacune a des compétences, des disponibilités, un cadre de travail (durée visée, plafonds) et des souhaits.</p>

      <details className="card">
        <summary>Règles par défaut (valables pour tout le monde, sauf précision sur une personne)</summary>
        <div className="grid">
          <Field label="Repos minimal entre deux vacations (h)"><HoursInput value={space.rules.minRestUnits} onChange={(v) => setRule({ minRestUnits: v ?? 0 })} /></Field>
          <Field label="Jours de travail d'affilée au plus"><input type="number" min={1} max={14} value={space.rules.maxConsecutiveDays} onChange={(e) => setRule({ maxConsecutiveDays: Math.max(1, Number(e.target.value) || 1) })} /></Field>
          <Field label="Durée maximale par jour (h)"><HoursInput value={space.rules.maxDayUnits} onChange={(v) => setRule({ maxDayUnits: v || 1 })} /></Field>
          <Field label="Durée maximale par semaine (h)"><HoursInput value={space.rules.maxWeekUnits} onChange={(v) => setRule({ maxWeekUnits: v || 1 })} /></Field>
        </div>
        <p className="hint">Ces règles sont toujours respectées. Les valeurs initiales (11 h de repos, 6 jours, 10 h par jour, 48 h par semaine) sont celles du droit du travail en France, à adapter à votre convention.</p>
        <Errors errors={rulesErrors} />
      </details>

      {!draft && <Errors errors={errors} />}
      <table>
        <thead>
          <tr><th>Nom</th><th>Compétences</th><th>Durée visée</th><th>Disponibilités</th><th>Absences</th><th /></tr>
        </thead>
        <tbody>
          {space.resources.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.skills.join(", ") || "—"}</td>
              <td>{r.contract.targetWeekUnits ? `${formatHours(r.contract.targetWeekUnits)} / semaine` : "—"}</td>
              <td>{summary(r)}</td>
              <td>{r.absences.length || "—"}</td>
              <td className="actions">
                <button onClick={() => { setDraft(structuredClone(r)); setErrors(null); }}>Modifier</button>
                <button className="danger" onClick={() => remove(r.id)}>Supprimer</button>
              </td>
            </tr>
          ))}
          {space.resources.length === 0 && <tr><td colSpan={6} className="empty">Aucune ressource.</td></tr>}
        </tbody>
      </table>

      {draft && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <h3>{space.resources.some((r) => r.id === draft.id) ? "Modifier la ressource" : "Nouvelle ressource"}</h3>
          <div className="grid">
            <Field label="Nom"><input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Compétences" hint="Séparées par des virgules (caisse, stock…)">
              <input list="skills" value={draft.skills.join(", ")} onChange={(e) => setDraft({ ...draft, skills: splitList(e.target.value) })} />
              <datalist id="skills">{allSkills.map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
          </div>

          <h4>Cadre de travail</h4>
          <p className="hint">Laissez vide pour appliquer la règle par défaut. La durée visée est un objectif (jamais une obligation) ; le reste est toujours respecté.</p>
          <div className="grid">
            <Field label="Durée visée par semaine (h)"><HoursInput value={draft.contract.targetWeekUnits} onChange={(v) => setContract({ targetWeekUnits: v || undefined })} /></Field>
            <Field label="Plafond par semaine (h)"><HoursInput value={draft.contract.maxWeekUnits} placeholder={String(space.rules.maxWeekUnits / 4)} onChange={(v) => setContract({ maxWeekUnits: v || undefined })} /></Field>
            <Field label="Plafond par jour (h)"><HoursInput value={draft.contract.maxDayUnits} placeholder={String(space.rules.maxDayUnits / 4)} onChange={(v) => setContract({ maxDayUnits: v || undefined })} /></Field>
            <Field label="Jours d'affilée au plus">
              <input type="number" min={1} max={14} placeholder={String(space.rules.maxConsecutiveDays)} value={draft.contract.maxConsecutiveDays ?? ""} onChange={(e) => setContract({ maxConsecutiveDays: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </Field>
            <Field label="Repos minimal (h)"><HoursInput value={draft.contract.minRestUnits} placeholder={String(space.rules.minRestUnits / 4)} onChange={(v) => setContract({ minRestUnits: v })} /></Field>
          </div>

          <h4>Disponibilités</h4>
          <p className="hint">Sans plage, la personne est disponible à toute heure. Avec des plages, elle ne peut être placée que sur des vacations entièrement comprises dans l'une d'elles.</p>
          {draft.weekly.map((w, i) => (
            <div className="rule" key={i}>
              <DaysPicker value={w.days} onChange={(days) => setDraft({ ...draft, weekly: draft.weekly.map((x, j) => (j === i ? { ...x, days } : x)) })} />
              <TimeSelect value={w.start} onChange={(start) => setDraft({ ...draft, weekly: draft.weekly.map((x, j) => (j === i ? { ...x, start } : x)) })} />
              <span>à</span>
              <TimeSelect allowEnd value={w.end} onChange={(end) => setDraft({ ...draft, weekly: draft.weekly.map((x, j) => (j === i ? { ...x, end } : x)) })} />
              <button type="button" onClick={() => setDraft({ ...draft, weekly: draft.weekly.filter((_, j) => j !== i) })}>Retirer</button>
            </div>
          ))}
          <button type="button" onClick={() => setDraft({ ...draft, weekly: [...draft.weekly, { days: [0, 1, 2, 3, 4], start: "08:00", end: "18:00" }] })}>Ajouter une plage</button>

          <h4>Absences</h4>
          <p className="hint">Congés, maladie, formation : jours entiers, jamais travaillés.</p>
          {draft.absences.map((a, i) => {
            const set = (patch: Partial<typeof a>) => setDraft({ ...draft, absences: draft.absences.map((y, j) => (j === i ? { ...y, ...patch } : y)) });
            return (
              <div className="rule" key={i}>
                <input type="date" required value={a.start} onChange={(e) => set({ start: e.target.value })} aria-label="Début" />
                <span>au</span>
                <input type="date" required value={a.end} onChange={(e) => set({ end: e.target.value })} aria-label="Fin" />
                <input placeholder="Motif" value={a.reason ?? ""} onChange={(e) => set({ reason: e.target.value || undefined })} />
                <button type="button" onClick={() => setDraft({ ...draft, absences: draft.absences.filter((_, j) => j !== i) })}>Retirer</button>
              </div>
            );
          })}
          <button type="button" onClick={() => setDraft({ ...draft, absences: [...draft.absences, { start: "2026-11-02", end: "2026-11-06" }] })}>Ajouter une absence</button>

          <h4>Souhaits</h4>
          <p className="hint">Pris en compte quand c'est possible, sans jamais empêcher de couvrir un besoin.</p>
          <div className="rule"><span>Jours préférés</span><DaysPicker value={draft.preferences.preferDays} onChange={(preferDays) => setPrefs({ preferDays })} /></div>
          <div className="rule"><span>Jours à éviter</span><DaysPicker value={draft.preferences.avoidDays} onChange={(avoidDays) => setPrefs({ avoidDays })} /></div>
          {space.needs.length > 0 && (
            <>
              <div className="rule">
                <span>Besoins préférés</span>
                <span className="days">{space.needs.map((n) => (
                  <label key={n.id} className={draft.preferences.preferNeedIds.includes(n.id) ? "chip on" : "chip"}>
                    <input type="checkbox" checked={draft.preferences.preferNeedIds.includes(n.id)} onChange={(e) => setPrefs({ preferNeedIds: e.target.checked ? [...draft.preferences.preferNeedIds, n.id] : draft.preferences.preferNeedIds.filter((x) => x !== n.id) })} />
                    {n.label}
                  </label>
                ))}</span>
              </div>
              <div className="rule">
                <span>Besoins à éviter</span>
                <span className="days">{space.needs.map((n) => (
                  <label key={n.id} className={draft.preferences.avoidNeedIds.includes(n.id) ? "chip on" : "chip"}>
                    <input type="checkbox" checked={draft.preferences.avoidNeedIds.includes(n.id)} onChange={(e) => setPrefs({ avoidNeedIds: e.target.checked ? [...draft.preferences.avoidNeedIds, n.id] : draft.preferences.avoidNeedIds.filter((x) => x !== n.id) })} />
                    {n.label}
                  </label>
                ))}</span>
              </div>
            </>
          )}
          <Field label="Jours libres souhaités" hint="Dates AAAA-MM-JJ séparées par des virgules">
            <input value={draft.preferences.offDates.join(", ")} onChange={(e) => setPrefs({ offDates: splitList(e.target.value) })} />
          </Field>

          <Errors errors={errors} />
          <div className="form-actions">
            <button type="submit" className="primary">Enregistrer</button>
            <button type="button" onClick={() => { setDraft(null); setErrors(null); }}>Annuler</button>
          </div>
        </form>
      )}
    </section>
  );
}
