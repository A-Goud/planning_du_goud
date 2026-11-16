import { useState } from "react";
import { periodSchema, suggestPeriods, type Period } from "@planning/core";
import { newId, upsert, useStore } from "../store.js";
import { Errors, Field } from "../ui.js";

export function PeriodsView() {
  const { space, commit } = useStore();
  const [draft, setDraft] = useState<Period | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [from, setFrom] = useState("2026-11-02");
  const [to, setTo] = useState("2027-06-30");
  const [weeks, setWeeks] = useState(4);
  const [proposal, setProposal] = useState<Omit<Period, "id">[] | null>(null);
  const [closureErrors, setClosureErrors] = useState<string[] | null>(null);
  const addClosure = () => setClosureErrors(commit({ ...space, closures: [...space.closures, { start: "2026-12-24", end: "2027-01-02", label: "Vacances" }] }));
  const editClosure = (i: number, patch: Partial<(typeof space.closures)[number]>) =>
    setClosureErrors(commit({ ...space, closures: space.closures.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const acceptProposal = () => {
    if (!proposal) return;
    const added = proposal.map((p) => periodSchema.parse({ ...p, id: newId("p") }));
    const result = commit({ ...space, periods: [...space.periods, ...added] });
    setClosureErrors(result);
    if (!result) setProposal(null);
  };

  const save = () => {
    if (!draft) return;
    const result = commit({ ...space, periods: upsert(space.periods, draft) });
    setErrors(result);
    if (!result) setDraft(null);
  };

  const sorted = [...space.periods].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <section>
      <div className="toolbar">
        <h2>Périodes</h2>
        <button className="primary" onClick={() => { setDraft(periodSchema.parse({ id: newId("p"), name: "", start: "2026-11-02", end: "2026-11-29" })); setErrors(null); }}>Ajouter une période</button>
      </div>
      <p className="hint">Tranches de planning à générer (en général quelques semaines : un planning est publié à l'avance, période par période). Chaque période est calculée séparément.</p>
      {!draft && <Errors errors={errors} />}
      <table>
        <thead><tr><th>Nom</th><th>Du</th><th>Au</th><th /></tr></thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td><td>{p.start}</td><td>{p.end}</td>
              <td className="actions">
                <button onClick={() => { setDraft({ ...p }); setErrors(null); }}>Modifier</button>
                <button className="danger" onClick={() => setErrors(commit({ ...space, periods: space.periods.filter((x) => x.id !== p.id) }))}>Supprimer</button>
              </td>
            </tr>
          ))}
          {sorted.length === 0 && <tr><td colSpan={4} className="empty">Aucune période.</td></tr>}
        </tbody>
      </table>
      <div className="card">
        <h3>Fermetures générales (jours fériés, congés de l'établissement)</h3>
        <p className="hint">Jours fériés ou fermetures de l'établissement : aucun besoin à couvrir ces jours-là (sauf date ponctuelle explicite). Ils servent aussi à proposer des périodes.</p>
        {space.closures.map((c, i) => (
          <div className="rule" key={i}>
            <input value={c.label} onChange={(e) => editClosure(i, { label: e.target.value })} aria-label="Nom" />
            <input type="date" value={c.start} onChange={(e) => editClosure(i, { start: e.target.value })} aria-label="Début" />
            <span>au</span>
            <input type="date" value={c.end} onChange={(e) => editClosure(i, { end: e.target.value })} aria-label="Fin" />
            <button type="button" onClick={() => setClosureErrors(commit({ ...space, closures: space.closures.filter((_, j) => j !== i) }))}>Retirer</button>
          </div>
        ))}
        <button type="button" onClick={addClosure}>Ajouter une fermeture</button>
        <h4>Proposer des périodes</h4>
        <div className="rule">
          <span>De</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>à</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <span>environ</span><input type="number" min={2} max={12} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} style={{ width: 70 }} /><span>semaines</span>
          <button type="button" onClick={() => setProposal(suggestPeriods(from, to, space.closures, weeks))}>Proposer</button>
        </div>
        {proposal && (
          <>
            <ul>{proposal.map((p, i) => <li key={i}>{p.start} → {p.end}</li>)}</ul>
            {proposal.length === 0 && <p className="hint">Aucune période à proposer sur cet intervalle.</p>}
            <div className="form-actions">
              <button type="button" className="primary" disabled={proposal.length === 0} onClick={acceptProposal}>Ajouter ces périodes</button>
              <button type="button" onClick={() => setProposal(null)}>Ignorer</button>
            </div>
            <p className="hint">Elles seront nommées par leurs dates ; vous pouvez ensuite les renommer ou les ajuster.</p>
          </>
        )}
        <Errors errors={closureErrors} />
      </div>

      {draft && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <h3>{space.periods.some((p) => p.id === draft.id) ? "Modifier la période" : "Nouvelle période"}</h3>
          <div className="grid">
            <Field label="Nom"><input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Début"><input type="date" required value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></Field>
            <Field label="Fin"><input type="date" required value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} /></Field>
          </div>
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
