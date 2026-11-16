export function AboutView() {
  return (
    <section className="about">
      <h2>À propos et limites</h2>

      <h3>Ce que fait ce logiciel</h3>
      <ul>
        <li>Il <strong>génère des plannings de travail</strong> : vous décrivez les besoins à couvrir (vacations, compétences, effectifs) et les personnes (compétences, disponibilités, cadre de travail, souhaits) ; le logiciel place les personnes pour que <strong>tous les besoins soient pourvus</strong> et que <strong>chacun soit occupé</strong> selon sa durée visée.</li>
        <li>C'est le pendant de « La planif d'Alix » (qui, à l'inverse, cherche des places pour que chaque demandeur obtienne ce qu'il souhaite).</li>
        <li>Les règles du travail (repos, plafonds, jours d'affilée, compétences, absences, disponibilités) sont <strong>toujours respectées</strong>. Les souhaits, la durée visée et l'équité sont des objectifs : ils passent après la couverture des besoins.</li>
        <li>Le logiciel ne répond jamais « impossible » : si l'équipe ne suffit pas, les places vides sont signalées (par ordre de priorité des besoins), expliquées, et des solutions sont testées.</li>
      </ul>

      <h3>Vos données</h3>
      <ul>
        <li>Tout reste sur votre appareil. Le site ne fait que livrer l'application : il ne reçoit ni ne conserve aucune donnée, et il n'y a pas de compte.</li>
        <li>L'application enregistre automatiquement dans ce navigateur. Cet enregistrement disparaît si vous effacez les données du site, changez de navigateur ou d'ordinateur, ou travaillez en navigation privée.</li>
        <li><strong>Enregistrez régulièrement un fichier</strong> : c'est votre vraie sauvegarde. Les fichiers ne sont ni chiffrés ni signés ; à l'ouverture, leur structure est vérifiée.</li>
        <li>Les plannings s'exportent en CSV (tableur) et en .ics (agenda de chaque personne).</li>
      </ul>

      <h3>Le compagnon de calcul (facultatif)</h3>
      <ul>
        <li>Pour les gros problèmes : un programme à lancer vous-même (<code>compagnon.exe</code> sous Windows). Laissez sa fenêtre ouverte pendant les calculs.</li>
        <li>Il n'écoute que votre ordinateur et n'accepte que ce site.</li>
      </ul>

      <h3>Limites</h3>
      <ul>
        <li>Les vacations ont des horaires fixes (pas de découpage libre de la journée). Une vacation de nuit se termine le lendemain.</li>
        <li>Les règles sont appliquées dans la période calculée : les jours travaillés ou les heures de la période précédente ne sont pas pris en compte à la jonction.</li>
        <li>Les règles par défaut (11 h de repos, 6 jours, 10 h/jour, 48 h/semaine) sont indicatives : vérifiez-les au regard de votre convention. Le logiciel est une aide, pas un avis juridique.</li>
        <li>Le calcul est exact quand « Planning optimal » est affiché ; sinon c'est le meilleur planning trouvé dans le temps imparti.</li>
      </ul>
    </section>
  );
}
