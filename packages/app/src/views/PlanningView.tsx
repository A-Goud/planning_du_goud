import { useEffect, useMemo, useRef, useState } from "react";
import {
  absenceOn,
  analyzePlanning,
  eachDate,
  formatDate,
  formatHours,
  formatTime,
  isClosed,
  periodOccurrences,
  planningToCsv,
  planningToIcs,
  weekday,
  whyNot,
  type Analysis,
  type Occurrence,
  type Planning,
  type Space,
} from "@planning/core";
import {
  COMPANION_RECOMMENDED_ABOVE,
  DEFAULT_COMPANION_URL,
  applyPatch,
  detectCompanion,
  estimateVariables,
  type CompanionInfo,
  type DiagnoseResult,
  type SolveOutcome,
} from "@planning/solver";
import { startDiagnose, startSolve, type Job, type SolveJob } from "../solveClient.js";
import { useStore } from "../store.js";
import { DAY_NAMES, needColor, shortDate } from "../ui.js";

type Mode = "scratch" | "minimal" | "complete";
type Sub = "grid" | "coverage" | "hours";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const emptyPlanning = (periodId: string): Planning => ({ periodId, assignments: [], forbidden: [] });

export function PlanningView() {
  const { space, commit } = useStore();
  const periods = [...space.periods].sort((a, b) => a.start.localeCompare(b.start));
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const period = space.periods.find((p) => p.id === periodId) ?? periods[0];
  const pid = period?.id ?? "";
  const planning = space.plannings.find((p) => p.periodId === pid);

  const [mode, setMode] = useState<Mode>("scratch");
  const [timeLimit, setTimeLimit] = useState(60);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<SolveOutcome | null>(null);
  const [sub, setSub] = useState<Sub>("grid");
  const [selected, setSelected] = useState<{ resourceId: string; date: string } | null>(null);
  const [icsFor, setIcsFor] = useState("");
  const job = useRef<SolveJob | null>(null);
  const diagJob = useRef<Job<DiagnoseResult> | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnoseResult | null>(null);

  const [engine, setEngine] = useState<"browser" | "companion">("browser");
  const [companion, setCompanion] = useState<CompanionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const checkCompanion = async () => {
    setChecking(true);
    const info = await detectCompanion(DEFAULT_COMPANION_URL);
    setCompanion(info);
    if (!info) setEngine("browser");
    setChecking(false);
  };
  useEffect(() => { void checkCompanion(); }, []);
  const companionUrl = engine === "companion" && companion ? DEFAULT_COMPANION_URL : undefined;

  const occurrences = useMemo(() => (pid ? periodOccurrences(space, pid) : []), [space, pid]);
  const analysis = useMemo(() => (pid ? analyzePlanning(space, pid) : null), [space, pid]);
  const estimated = useMemo(() => (pid ? estimateVariables(space, pid) : 0), [space, pid]);
  const bigProblem = estimated > COMPANION_RECOMMENDED_ABOVE;

  useEffect(() => { setSelected(null); setDiagnosis(null); setLast(null); }, [pid]);

  const savePlanning = (next: Planning) => {
    const others = space.plannings.filter((p) => p.periodId !== next.periodId);
    return commit({ ...space, plannings: [...others, next] });
  };

  const run = async () => {
    if (!pid) return;
    setRunning(true);
    setError(null);
    setDiagnosis(null);
    const j = startSolve(
      space,
      {
        periodId: pid,
        solverOptions: { timeLimitSec: timeLimit, gap: 0.01 },
        ...(mode === "minimal" && planning ? { reference: planning, stability: "preferred" as const } : {}),
        ...(mode === "complete" ? { freezeExisting: true } : {}),
      },
      companionUrl,
    );
    job.current = j;
    try {
      const outcome = await j.promise;
      setLast(outcome);
      if (outcome.status === "optimal" || outcome.status === "feasible") {
        const errors = savePlanning(outcome.planning);
        if (errors) setError(errors.join(" ; "));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      job.current = null;
    }
  };

  const diagnose = async () => {
    if (!pid) return;
    setDiagnosing(true);
    setError(null);
    const j = startDiagnose(
      space,
      {
        periodId: pid,
        solverOptions: { timeLimitSec: Math.min(timeLimit, 15), gap: 0.02 },
        ...(mode === "complete" ? { freezeExisting: true } : {}),
      },
      companionUrl,
    );
    diagJob.current = j;
    try {
      setDiagnosis(await j.promise);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiagnosing(false);
      diagJob.current = null;
    }
  };

  const clear = (keepLocked: boolean) => {
    if (!planning) return;
    savePlanning({ ...planning, assignments: keepLocked ? planning.assignments.filter((a) => a.locked) : [] });
    setDiagnosis(null);
    setLast(null);
  };

  if (periods.length === 0 || !period) {
    return <p className="empty">Créez d'abord une période dans l'onglet « Périodes » (ou chargez l'exemple).</p>;
  }
  const hasData = space.resources.length > 0 && occurrences.length > 0;
  const placed = planning?.assignments.length ?? 0;

  return (
    <section>
      <div className="card controls">
        <label className="field">
          <span className="field-label">Période</span>
          <select value={pid} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.start} → {p.end})</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Calcul</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="scratch">Repartir de zéro (garde les verrous)</option>
            <option value="minimal" disabled={placed === 0}>Changer le moins possible</option>
            <option value="complete" disabled={placed === 0}>Compléter sans toucher à l'existant</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Temps maximal (s)</span>
          <input type="number" min={5} max={3600} value={timeLimit} onChange={(e) => setTimeLimit(Math.max(5, Number(e.target.value) || 60))} style={{ width: 90 }} />
        </label>
      </div>
      <div className="card controls">
        <label className="field">
          <span className="field-label">Solveur</span>
          <select value={engine} onChange={(e) => setEngine(e.target.value as "browser" | "companion")}>
            <option value="browser">Navigateur (sans installation)</option>
            <option value="companion" disabled={!companion}>
              {companion ? `Compagnon local (HiGHS ${companion.engine === "native" ? "natif" : "WebAssembly"})` : "Compagnon local (non détecté)"}
            </option>
          </select>
        </label>
        <button onClick={() => void checkCompanion()} disabled={checking}>{checking ? "Recherche…" : "Rechercher le compagnon"}</button>
        <button onClick={() => setShowHelp(!showHelp)}>{showHelp ? "Masquer l'aide" : "Qu'est-ce que le compagnon ?"}</button>
        <span className="hint">Taille estimée : environ {estimated.toLocaleString("fr-FR")} variables.</span>
      </div>
      {bigProblem && engine === "browser" && (
        <p className="warning">
          Ce problème est volumineux : le calcul dans le navigateur peut être long, voire manquer de mémoire.{" "}
          {companion ? <button onClick={() => setEngine("companion")}>Utiliser le compagnon</button> : <>Le compagnon local est recommandé. <button onClick={() => setShowHelp(true)}>Comment l'installer</button></>}
        </p>
      )}
      {showHelp && <CompanionHelp onClose={() => setShowHelp(false)} />}

      <div className="toolbar buttons">
        {running ? (
          <button onClick={() => job.current?.cancel()}>Annuler le calcul</button>
        ) : (
          <>
            <button className="primary" onClick={() => void run()} disabled={!hasData}>Générer le planning</button>
            <button onClick={() => clear(true)} disabled={placed === 0}>Effacer (garder les verrous)</button>
            <button className="danger" onClick={() => { if (confirm("Effacer tout le planning de cette période, verrous compris ?")) clear(false); }} disabled={placed === 0}>Tout effacer</button>
          </>
        )}
        <span className="lock-actions">
          <button onClick={() => download(`planning-${period.start}.csv`, planningToCsv(space, pid), "text/csv;charset=utf-8")} disabled={placed === 0}>Exporter en CSV</button>
          <select aria-label="Personne" value={icsFor} onChange={(e) => setIcsFor(e.target.value)}>
            <option value="">Agenda d'une personne…</option>
            {space.resources.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button
            disabled={!icsFor}
            onClick={() => {
              const name = space.resources.find((r) => r.id === icsFor)?.name ?? "planning";
              download(`${name.replace(/[^\p{L}\p{N}]+/gu, "-")}-${period.start}.ics`, planningToIcs(space, pid, icsFor), "text/calendar;charset=utf-8");
            }}
          >
            Exporter en .ics
          </button>
        </span>
      </div>
      {!hasData && <p className="hint">Il faut au moins une ressource et un besoin qui tombe dans cette période.</p>}
      {error && <p className="errors" role="alert">{error}</p>}

      {last && <Outcome outcome={last} />}
      {analysis && placed > 0 && <Summary analysis={analysis} />}

      <nav className="tabs sub" role="tablist">
        {([["grid", "Grille"], ["coverage", "À pourvoir"], ["hours", "Heures"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={sub === id} className={sub === id ? "active" : ""} onClick={() => setSub(id)}>{label}</button>
        ))}
      </nav>

      {analysis && sub === "grid" && (
        <Grid space={space} pid={pid} occurrences={occurrences} planning={planning} analysis={analysis} selected={selected} onSelect={setSelected} />
      )}
      {analysis && sub === "grid" && selected && (
        <CellEditor space={space} pid={pid} occurrences={occurrences} planning={planning ?? emptyPlanning(pid)} selected={selected} onSave={savePlanning} onClose={() => setSelected(null)} />
      )}
      {analysis && sub === "coverage" && <Coverage analysis={analysis} />}
      {analysis && sub === "hours" && <Hours analysis={analysis} />}

      {analysis && analysis.violations.length > 0 && (
        <div className="card">
          <h3>Règles non respectées ({analysis.violations.length})</h3>
          <p className="hint">Placements manuels ou données modifiées depuis le dernier calcul. Un nouveau calcul les corrige (sauf verrous).</p>
          <ul>{analysis.violations.slice(0, 40).map((v, i) => <li key={i} className="bad">{v}</li>)}</ul>
          {analysis.violations.length > 40 && <p className="hint">… et {analysis.violations.length - 40} autres.</p>}
        </div>
      )}

      {analysis && analysis.missingSeats > 0 && placed > 0 && (
        <div className="card diag">
          <div className="toolbar">
            <h3>Pourquoi des places restent vides ?</h3>
            {diagnosing ? <button onClick={() => diagJob.current?.cancel()}>Annuler l'analyse</button> : <button onClick={() => void diagnose()}>Analyser et tester des solutions</button>}
          </div>
          {!diagnosis && !diagnosing && <p className="hint">L'analyse explique chaque besoin incomplet et relance le calcul en relâchant une règle à la fois, pour voir ce qui débloquerait la situation. Rien n'est appliqué sans votre accord.</p>}
          {diagnosing && <p className="status">Analyse en cours : plusieurs calculs d'essai…</p>}
          {diagnosis && <Diagnosis space={space} pid={pid} result={diagnosis} onApply={(next) => { const e = commit(next); if (e) setError(e.join(" ; ")); else setDiagnosis(null); }} />}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ bilan

function Outcome({ outcome }: { outcome: SolveOutcome }) {
  const ok = outcome.status === "optimal" || outcome.status === "feasible";
  return (
    <div className="card bilan">
      <strong className={ok ? "ok" : "bad"}>
        {outcome.status === "optimal" ? "Planning optimal" : outcome.status === "feasible" ? "Meilleur planning trouvé dans le temps imparti" : "Aucun planning produit"}
      </strong>
      <span className="status"> — {outcome.stats.variables.toLocaleString("fr-FR")} variables, {outcome.stats.millis.toLocaleString("fr-FR")} ms</span>
      {outcome.warnings.map((w, i) => <p className="warning" key={i}>{w}</p>)}
    </div>
  );
}

function Summary({ analysis }: { analysis: Analysis }) {
  const total = analysis.coverage.reduce((n, c) => n + c.required, 0);
  return (
    <div className="card bilan">
      {analysis.missingSeats === 0 ? (
        <strong className="ok">Toutes les places sont pourvues ({total}).</strong>
      ) : (
        <strong className="bad">{analysis.missingSeats} place(s) vide(s) sur {total}.</strong>
      )}
      <span className="status"> — </span>
      {analysis.underTargetUnits > 0 ? <span>{formatHours(analysis.underTargetUnits)} manquent pour atteindre les durées visées.</span> : <span>durées visées atteintes.</span>}
    </div>
  );
}

// ------------------------------------------------------------------ grille

function Grid(props: {
  space: Space;
  pid: string;
  occurrences: Occurrence[];
  planning: Planning | undefined;
  analysis: Analysis;
  selected: { resourceId: string; date: string } | null;
  onSelect(s: { resourceId: string; date: string } | null): void;
}) {
  const { space, pid, planning, analysis, selected, onSelect } = props;
  const period = space.periods.find((p) => p.id === pid)!;
  const dates = eachDate(period.start, period.end);
  const needIndex = new Map(space.needs.map((n, i) => [n.id, i]));
  const byCell = new Map<string, NonNullable<Planning["assignments"]>>();
  for (const a of planning?.assignments ?? []) {
    const k = `${a.resourceId}|${a.date}`;
    byCell.set(k, [...(byCell.get(k) ?? []), a]);
  }
  const missingByDate = new Map<string, number>();
  for (const c of analysis.coverage) if (c.missing > 0) missingByDate.set(c.date, (missingByDate.get(c.date) ?? 0) + c.missing);

  return (
    <div className="roster-wrap">
      <table className="roster">
        <thead>
          <tr>
            <th className="sticky">Personne</th>
            {dates.map((d) => (
              <th key={d} className={`${weekday(d) >= 5 ? "we" : ""} ${isClosed(space.closures, d) ? "closed" : ""}`} title={isClosed(space.closures, d)?.label}>
                {DAY_NAMES[weekday(d)]}<br />{shortDate(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {space.resources.map((r) => (
            <tr key={r.id}>
              <th className="sticky">{r.name}</th>
              {dates.map((d) => {
                const cell = byCell.get(`${r.id}|${d}`) ?? [];
                const absent = absenceOn(r, d);
                const off = r.preferences.offDates.includes(d);
                const forbidden = planning?.forbidden.some((f) => f.resourceId === r.id && f.date === d && f.needId === undefined);
                const isSel = selected?.resourceId === r.id && selected.date === d;
                return (
                  <td
                    key={d}
                    className={`${weekday(d) >= 5 ? "we" : ""} ${absent ? "absent" : ""} ${isSel ? "sel" : ""}`}
                    title={absent ? `Absent(e)${absent.reason ? " : " + absent.reason : ""}` : forbidden ? "Interdit ce jour" : off ? "Souhaite être libre" : undefined}
                    onClick={() => onSelect(isSel ? null : { resourceId: r.id, date: d })}
                  >
                    {cell.map((a) => {
                      const need = space.needs.find((n) => n.id === a.needId);
                      return (
                        <span key={a.needId} className="shift" style={{ background: needColor(needIndex.get(a.needId) ?? 0) }}>
                          {a.locked ? "🔒 " : ""}{need?.label ?? a.needId}
                        </span>
                      );
                    })}
                    {cell.length === 0 && (absent ? <span className="mark">abs.</span> : forbidden ? <span className="mark">✕</span> : off ? <span className="mark">souhait</span> : null)}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="gaps">
            <th className="sticky">Places vides</th>
            {dates.map((d) => {
              const n = missingByDate.get(d) ?? 0;
              return <td key={d} className={n ? "bad" : ""}>{n || ""}</td>;
            })}
          </tr>
        </tbody>
      </table>
      <p className="hint">Cliquez sur une case pour placer, retirer, verrouiller ou interdire. Les placements manuels sont verrouillés : un nouveau calcul les conserve.</p>
      <ul className="legend">
        {space.needs.map((n, i) => <li key={n.id}><span className="shift" style={{ background: needColor(i) }}>{n.label}</span> {n.start}–{n.end}</li>)}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ édition d'une case

function CellEditor(props: {
  space: Space;
  pid: string;
  occurrences: Occurrence[];
  planning: Planning;
  selected: { resourceId: string; date: string };
  onSave(p: Planning): string[] | null;
  onClose(): void;
}) {
  const { space, occurrences, planning, selected, onSave, onClose } = props;
  const [error, setError] = useState<string | null>(null);
  const resource = space.resources.find((r) => r.id === selected.resourceId);
  if (!resource) return null;
  const byKey = new Map(occurrences.map((o) => [o.key, o]));
  const day = occurrences.filter((o) => o.date === selected.date);
  const mine = planning.assignments.filter((a) => a.resourceId === resource.id && a.date === selected.date);
  const dayForbidden = planning.forbidden.find((f) => f.resourceId === resource.id && f.date === selected.date && f.needId === undefined);

  const save = (next: Planning) => setError(onSave(next)?.join(" ; ") ?? null);
  const place = (o: Occurrence) =>
    save({ ...planning, assignments: [...planning.assignments, { needId: o.needId, date: o.date, resourceId: resource.id, locked: true }] });
  const remove = (needId: string) =>
    save({ ...planning, assignments: planning.assignments.filter((a) => !(a.needId === needId && a.date === selected.date && a.resourceId === resource.id)) });
  const toggleLock = (needId: string) =>
    save({ ...planning, assignments: planning.assignments.map((a) => (a.needId === needId && a.date === selected.date && a.resourceId === resource.id ? { ...a, locked: !a.locked } : a)) });
  const forbidDay = () =>
    save({
      ...planning,
      assignments: planning.assignments.filter((a) => !(a.resourceId === resource.id && a.date === selected.date)),
      forbidden: [...planning.forbidden, { resourceId: resource.id, date: selected.date }],
    });
  const liftForbid = () =>
    save({ ...planning, forbidden: planning.forbidden.filter((f) => !(f.resourceId === resource.id && f.date === selected.date && f.needId === undefined)) });

  return (
    <div className="card">
      <div className="toolbar">
        <h3>{resource.name} — {formatDate(selected.date)}</h3>
        <button onClick={onClose}>Fermer</button>
      </div>
      {mine.length > 0 && (
        <ul className="blocked-list">
          {mine.map((a) => {
            const o = byKey.get(`${a.needId}|${a.date}`);
            return (
              <li key={a.needId}>
                <span>{o ? `${o.label} ${formatTime(o.start)}–${formatTime(o.end > 96 ? o.end - 96 : o.end)}` : a.needId}{a.locked ? " 🔒" : ""}</span>
                <span>
                  <button onClick={() => toggleLock(a.needId)}>{a.locked ? "Déverrouiller" : "Verrouiller"}</button>{" "}
                  <button className="danger" onClick={() => remove(a.needId)}>Retirer</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <h4>Placer sur une vacation de ce jour</h4>
      {day.length === 0 && <p className="hint">Aucune vacation à couvrir ce jour-là.</p>}
      <ul className="blocked-list">
        {day.filter((o) => !mine.some((a) => a.needId === o.needId)).map((o) => {
          const why = whyNot(space, byKey, planning, resource, o);
          const count = planning.assignments.filter((a) => a.needId === o.needId && a.date === o.date).length;
          return (
            <li key={o.key}>
              <span>
                {o.label} {formatTime(o.start)}–{formatTime(o.end > 96 ? o.end - 96 : o.end)} <span className="hint">({count}/{o.required})</span>
                {why.length > 0 && <span className="bad"> — {why.map((w) => w.text).join(" ; ")}</span>}
              </span>
              <button onClick={() => place(o)}>{why.length ? "Placer quand même" : "Placer"}</button>
            </li>
          );
        })}
      </ul>
      <div className="form-actions">
        {dayForbidden ? <button onClick={liftForbid}>Lever l'interdiction ce jour</button> : <button onClick={forbidDay}>Interdire ce jour (ne pas travailler)</button>}
      </div>
      {error && <p className="errors" role="alert">{error}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ à pourvoir et heures

function Coverage({ analysis }: { analysis: Analysis }) {
  const incomplete = analysis.coverage.filter((c) => c.missing > 0);
  if (incomplete.length === 0) return <p className="ok">Toutes les vacations sont complètes.</p>;
  return (
    <table>
      <thead><tr><th>Jour</th><th>Vacation</th><th>Horaires</th><th>Placés</th><th>Manque</th></tr></thead>
      <tbody>
        {incomplete.map((c) => (
          <tr key={c.key}>
            <td>{formatDate(c.date)}</td>
            <td>{c.label}</td>
            <td>{formatTime(c.start)}–{formatTime(c.end > 96 ? c.end - 96 : c.end)}</td>
            <td>{c.assigned} / {c.required}</td>
            <td className="bad">{c.missing}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Hours({ analysis }: { analysis: Analysis }) {
  const weeks = analysis.loads[0]?.weeks ?? [];
  return (
    <div className="roster-wrap">
      <table>
        <thead>
          <tr>
            <th>Personne</th>
            {weeks.map((w) => <th key={w.monday}>Sem. du {shortDate(w.monday)}</th>)}
            <th>Total</th><th>Vacations</th><th>Pénibles</th>
          </tr>
        </thead>
        <tbody>
          {analysis.loads.map((l) => (
            <tr key={l.resourceId}>
              <td>{l.name}</td>
              {l.weeks.map((w) => (
                <td key={w.monday} className={w.target !== undefined && w.units < w.target ? "bad" : ""}>
                  {formatHours(w.units)}{w.target !== undefined ? <span className="hint"> / {formatHours(w.target)}</span> : null}
                </td>
              ))}
              <td>{formatHours(l.totalUnits)}</td>
              <td>{l.shifts}</td>
              <td>{l.unpopular}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">En rouge : sous la durée visée. Pour occuper davantage les personnes sous-employées, autorisez un effectif maximal supérieur au requis sur les besoins concernés.</p>
    </div>
  );
}

// ------------------------------------------------------------------ diagnostic

function Diagnosis({ space, pid, result, onApply }: { space: Space; pid: string; result: DiagnoseResult; onApply(next: Space): void }) {
  if (result.diagnoses.length === 0) return <p className="ok">Rien à signaler : toutes les places sont pourvues.</p>;
  return (
    <>
      {result.diagnoses.map((d) => (
        <div key={d.needId}>
          <h4>
            {d.label} — {d.totalMissing} place(s) vide(s)
          </h4>
          <p className="hint">{d.missing.slice(0, 8).map((m) => `${formatDate(m.date)} (${m.missing})`).join(", ")}{d.missing.length > 8 ? `, … (${d.missing.length} jours)` : ""}</p>
          <ul>{d.causes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          {d.suggestions.length > 0 ? (
            <ul className="suggestions">
              {d.suggestions.map((s, i) => (
                <li key={i}>
                  <span>
                    <strong>{s.description}</strong> — {s.missingAfter === 0 ? "pourvoirait toutes les places de ce besoin" : `il resterait ${s.missingAfter} place(s) vide(s)`}
                    {s.collateral.length > 0 && <span className="bad"> ; mais {s.collateral.map((c) => `${c.label} perdrait ${c.lost}`).join(", ")}</span>}
                    <span className="hint"> (places vides au total : {s.totalMissingAfter})</span>
                  </span>
                  <button onClick={() => onApply(applyPatch(space, pid, s.patch))}>Appliquer</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Aucune des modifications testées ne débloque ce besoin : il faut davantage de personnes qualifiées et disponibles.</p>
          )}
        </div>
      ))}
      {result.skipped.length > 0 && <p className="hint">{result.skipped.length} autre(s) besoin(s) incomplet(s) n'ont pas été analysés.</p>}
      <p className="hint">Après avoir appliqué une modification, relancez « Générer le planning ».</p>
    </>
  );
}

// ------------------------------------------------------------------ compagnon

/** Explique le compagnon et génère le lanceur (le site autorisé y est inscrit). */
function CompanionHelp({ onClose }: { onClose(): void }) {
  const origin = window.location.origin;
  const download = () => {
    const script = `@echo off\r\ncd /d "%~dp0"\r\nnode companion.mjs --origin ${origin}\r\npause\r\n`;
    const url = URL.createObjectURL(new Blob([script], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "lancer-le-compagnon.cmd";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="card">
      <h3>Le compagnon local</h3>
      <p>
        Petit programme qui calcule à la place du navigateur, sur votre ordinateur : plus de mémoire, pas de blocage de la page, et un moteur natif si
        HiGHS est installé. Vos données ne quittent pas la machine : le compagnon n'écoute que cet ordinateur et n'accepte que ce site ({origin}).
      </p>
      <h4>Sous Windows : un seul fichier</h4>
      <ol>
        <li><a href="compagnon.exe" download>Téléchargez compagnon.exe</a> (environ 95 Mo, rien d'autre à installer).</li>
        <li>Double-cliquez dessus et <strong>laissez la fenêtre ouverte</strong> pendant les calculs.</li>
        <li>Revenez ici et cliquez sur « Rechercher le compagnon ».</li>
      </ol>
      <p className="hint">
        Au premier lancement, Windows affiche « Windows a protégé votre PC » : le programme n'est pas signé. Cliquez sur « Informations complémentaires »,
        puis « Exécuter quand même ». Le navigateur peut aussi demander l'autorisation d'accéder à un programme de votre réseau local : acceptez.
      </p>
      <details>
        <summary>Autres systèmes (macOS, Linux) ou si vous préférez Node.js</summary>
        <ol>
          <li>Installez <strong>Node.js</strong> (version 20 ou plus récente).</li>
          <li><a href="compagnon.zip" download>Téléchargez l'archive du compagnon</a> et décompressez-la : elle donne un dossier « compagnon ».</li>
          <li>Dans ce dossier, lancez : <code>node companion.mjs --origin {origin}</code> (sous Windows, le lanceur ci-dessous le fait pour vous).</li>
        </ol>
        <button onClick={download}>Télécharger le lanceur Windows (.cmd)</button>
      </details>
      <div className="form-actions">
        <button onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}
