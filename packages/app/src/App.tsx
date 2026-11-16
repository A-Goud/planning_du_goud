import { useRef, useState } from "react";
import { importSpace } from "@planning/core";
import { exampleSpace } from "./example.js";
import { downloadSpace, emptySpace } from "./storage.js";
import { StoreProvider, useStore } from "./store.js";
import { AboutView } from "./views/AboutView.js";
import { NeedsView } from "./views/NeedsView.js";
import { PeriodsView } from "./views/PeriodsView.js";
import { PlanningView } from "./views/PlanningView.js";
import { ResourcesView } from "./views/ResourcesView.js";
import { Errors } from "./ui.js";

const TABS = [
  { id: "resources", label: "Ressources" },
  { id: "needs", label: "Besoins" },
  { id: "periods", label: "Périodes" },
  { id: "planning", label: "Planning" },
  { id: "about", label: "À propos" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Shell() {
  const { space, ready, commit, replace } = useStore();
  const [tab, setTab] = useState<TabId>("planning");
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const result = importSpace(await file.text());
    if (result.ok) {
      replace(result.space);
      setImportErrors(null);
    } else {
      setImportErrors(result.errors);
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  if (!ready) return <p className="empty">Chargement…</p>;

  return (
    <div className="app">
      <header>
        <h1>Le planning d'Alix</h1>
        <input className="space-name" aria-label="Nom de l'espace" value={space.name} onChange={(e) => commit({ ...space, name: e.target.value || "Espace" })} />
        <div className="file-actions">
          <button onClick={() => { if (confirm("Remplacer l'espace actuel par un espace vide ?")) replace(emptySpace()); }}>Nouveau</button>
          <button onClick={() => { if (confirm("Remplacer l'espace actuel par l'exemple ?")) replace(exampleSpace()); }}>Charger l'exemple</button>
          <button onClick={() => fileInput.current?.click()}>Ouvrir un fichier</button>
          <button className="primary" onClick={() => downloadSpace(space)}>Enregistrer un fichier</button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
      </header>
      {importErrors && (
        <div className="card">
          <strong>Ce fichier n'a pas pu être ouvert :</strong>
          <Errors errors={importErrors} />
        </div>
      )}
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>
      <main>
        {tab === "resources" && <ResourcesView />}
        {tab === "needs" && <NeedsView />}
        {tab === "periods" && <PeriodsView />}
        {tab === "planning" && <PlanningView />}
        {tab === "about" && <AboutView />}
      </main>
      <footer className="hint">Vos données restent sur cet appareil : sauvegardées automatiquement dans le navigateur, et dans un fichier quand vous le demandez.</footer>
    </div>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
