import { useState } from "react";
import { needSchema, type Need } from "@planning/core";
import { newId, upsert, useStore } from "../store.js";
import { DAY_NAMES, DaysPicker, Errors, Field, TimeSelect, splitList } from "../ui.js";

function blank(): Need {
  return needSchema.parse({ id: newId("n"), label: "", days: [0, 1, 2, 3, 4], start: "08:00", end: "16:00" });
}

function when(n: Need): string {
  const days = n.days.map((d) => DAY_NAMES[d]).join(" ");
  const extra = n.extraDates.length ? ` + ${n.extraDates.length} date(s)` : "";
  return `${days || "—"}${extra} · ${n.start}–${n.end}`;
}

export function NeedsView() {
  const { space, commit } = useStore();
  const [draft, setDraft] = useState<Need | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const skills = [...new Set(space.resources.flatMap((r) => r.skills))].sort();

  const save = () => {
    if (!draft) return;
    const result = commit({ ...space, needs: upsert(space.needs, draft) });
    setErrors(result);
    if (!result) setDraft(null);
  };
  const remove = (id: string) => setErrors(commit({ ...space, needs: space.needs.filter((n) => n.id !== id) }));

  return (
    <section>
      <div className="toolbar">
        <h2>Besoins</h2>
        <button className="primary" onClick={() => { setDraft(blank()); setErrors(null); }}>Ajouter un besoin</button>
      </div>
      <p className="hint">
        Ce qu'il faut couvrir : une vacation récurrente (« Caisse, du lundi au samedi, 8 h–14 h, 2 personnes »). Le calcul place des personnes sur chaque
        vacation de chaque jour ; si une place ne peut pas être pourvue, il la laisse vide et explique pourquoi.
      </p>
      {!draft && <Errors errors={errors} />}
      <table>
        <thead>
          <tr><th>Besoin</th><th>Quand</th><th>Compétence</th><th>Effectif</th><th>Priorité</th><th /></tr>
        </thead>
        <tbody>
          {space.needs.map((n) => (
            <tr key={n.id}>
              <td>{n.label}{n.unpopular ? " (pénible)" : ""}</td>
              <td>{when(n)}</td>
              <td>{n.skill ?? "—"}</td>
              <td>{n.required}{n.max && n.max > n.required ? ` à ${n.max}` : ""}</td>
              <td>{n.priority}</td>
              <td className="actions">
                <button onClick={() => { setDraft(structuredClone(n)); setErrors(null); }}>Modifier</button>
                <button className="danger" onClick={() => remove(n.id)}>Supprimer</button>
              </td>
            </tr>
          ))}
          {space.needs.length === 0 && <tr><td colSpan={6} className="empty">Aucun besoin.</td></tr>}
        </tbody>
      </table>

      {draft && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <h3>{space.needs.some((n) => n.id === draft.id) ? "Modifier le besoin" : "Nouveau besoin"}</h3>
          <div className="grid">
            <Field label="Nom"><input required value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></Field>
            <Field label="Compétence exigée" hint="Vide = toute personne convient">
              <input list="need-skills" value={draft.skill ?? ""} onChange={(e) => setDraft({ ...draft, skill: e.target.value.trim() || undefined })} />
              <datalist id="need-skills">{skills.map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
            <Field label="Effectif requis"><input type="number" min={1} value={draft.required} onChange={(e) => setDraft({ ...draft, required: Math.max(1, Number(e.target.value) || 1) })} /></Field>
            <Field label="Effectif maximal" hint="Au-dessus du requis : sert à occuper les personnes sous leur durée visée">
              <input type="number" min={1} placeholder={String(draft.required)} value={draft.max ?? ""} onChange={(e) => setDraft({ ...draft, max: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </Field>
            <Field label="Priorité" hint="De 1 (basse) à 5 (haute) : décide quoi sacrifier si l'équipe ne suffit pas">
              <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <div className="rule"><span>Jours</span><DaysPicker value={draft.days} onChange={(days) => setDraft({ ...draft, days })} /></div>
          <div className="rule">
            <span>De</span>
            <TimeSelect value={draft.start} onChange={(start) => setDraft({ ...draft, start })} />
            <span>à</span>
            <TimeSelect allowEnd value={draft.end} onChange={(end) => setDraft({ ...draft, end })} />
            <span className="hint">Si la fin est avant le début, la vacation se termine le lendemain (équipe de nuit).</span>
          </div>
          <label className="check">
            <input type="checkbox" checked={draft.unpopular} onChange={(e) => setDraft({ ...draft, unpopular: e.target.checked })} />
            Vacation pénible (week-end, nuit, férié…) : sa charge est répartie équitablement
          </label>
          <Field label="Dates ponctuelles en plus" hint="Événement, ouverture exceptionnelle : dates AAAA-MM-JJ séparées par des virgules">
            <input value={draft.extraDates.join(", ")} onChange={(e) => setDraft({ ...draft, extraDates: splitList(e.target.value) })} />
          </Field>

          <h4>Exceptions</h4>
          <p className="hint">Un autre effectif certains jours (0 pour supprimer la vacation ce jour-là).</p>
          {draft.exceptions.map((x, i) => {
            const set = (patch: Partial<typeof x>) => setDraft({ ...draft, exceptions: draft.exceptions.map((y, j) => (j === i ? { ...y, ...patch } : y)) });
            return (
              <div className="rule" key={i}>
                <input type="date" required value={x.date} onChange={(e) => set({ date: e.target.value })} />
                <label className="check">Effectif <input type="number" min={0} style={{ width: 70 }} value={x.required} onChange={(e) => set({ required: Math.max(0, Number(e.target.value) || 0) })} /></label>
                <input placeholder="Motif" value={x.reason ?? ""} onChange={(e) => set({ reason: e.target.value || undefined })} />
                <button type="button" onClick={() => setDraft({ ...draft, exceptions: draft.exceptions.filter((_, j) => j !== i) })}>Retirer</button>
              </div>
            );
          })}
          <button type="button" onClick={() => setDraft({ ...draft, exceptions: [...draft.exceptions, { date: "2026-11-02", required: 0 }] })}>Ajouter une exception</button>

          {space.periods.length > 0 && (
            <>
              <h4>Périodes concernées</h4>
              <p className="hint">Aucune case cochée = toutes les périodes.</p>
              <span className="days">{space.periods.map((p) => (
                <label key={p.id} className={draft.periodIds.includes(p.id) ? "chip on" : "chip"}>
                  <input type="checkbox" checked={draft.periodIds.includes(p.id)} onChange={(e) => setDraft({ ...draft, periodIds: e.target.checked ? [...draft.periodIds, p.id] : draft.periodIds.filter((x) => x !== p.id) })} />
                  {p.name}
                </label>
              ))}</span>
            </>
          )}

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
