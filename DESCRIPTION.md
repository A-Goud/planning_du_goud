# Le planning d'Alix : génération de plannings de travail

Adresse prévue : `planning.potodugoud.fr` (sous-domaine de potodugoud.fr).

## 1. Objectif

Pendant de « La planif d'Alix » (dossier `planification_du_goud`), le sens du problème est inversé :

| | La planif | Le planning |
|---|---|---|
| Ce qui est contraint | les **ressources** (une salle ne sert qu'une fois) | les **besoins** (chaque vacation doit être pourvue) |
| Ce qui est souple | les **demandes** (on satisfait au mieux) | les **souhaits** des personnes, leur durée visée |
| Question posée | « Où placer chacun pour qu'il obtienne ce qu'il veut ? » | « Qui placer pour que tout soit couvert et que chacun soit occupé ? » |
| Résultat | planning d'occupation de salles | tableau de service (qui travaille quand) |

Le logiciel ne répond jamais « impossible » : si l'équipe ne suffit pas, il pourvoit les besoins par ordre de priorité, laisse des places vides, explique pourquoi et teste ce qui les débloquerait.

## 2. Ce qui est repris de « La planif »

- Moteur : modèle d'optimisation en nombres entiers (`MilpModel`) résolu par **HiGHS** (WebAssembly dans le navigateur, ou **compagnon local** pour les gros problèmes), calcul dans un Web Worker, annulable.
- Temps en quarts d'heure, calendrier daté, périodes, fermetures, suggestion de périodes.
- Fichier JSON versionné et validé (zod), sauvegarde automatique IndexedDB, tout est local.
- Objectifs pondérés, résolution partielle (verrous, « compléter sans toucher à l'existant »), stabilité par rapport à un planning de référence.
- Diagnostic : causes constatées + relances automatiques en relâchant une contrainte à la fois (l'utilisateur décide d'appliquer).
- Compagnon local, déploiement Caddy, socle de l'interface.

Ce qui n'est **pas** repris : demandeurs, groupes compatibles, capacité, motif hebdomadaire de 1 ou 2 semaines, délégation à un sous-niveau (un planning de service est généralement tout daté, sans motif répété).

## 3. Modèle de données

- **Ressource** : une personne. Compétences ; disponibilités hebdomadaires (vide = toujours) ; absences (jours entiers) ; **cadre de travail** (durée hebdomadaire visée, plafonds par semaine et par jour, jours d'affilée, repos minimal) ; **souhaits** (jours préférés/évités, besoins préférés/évités, jours libres).
- **Besoin** : une vacation récurrente à pourvoir : jours, heures (fin avant début = nuit), compétence exigée, effectif requis, effectif maximal, priorité 1–5, caractère « pénible », exceptions datées, dates ponctuelles.
- **Période** : plage de dates à générer. **Fermetures** : jours sans besoin.
- **Planning** : affectations datées (besoin, date, ressource, verrou) et interdictions.
- **Règles par défaut** de l'espace (repos 11 h, 6 jours, 10 h/jour, 48 h/semaine), modifiables.

## 4. Contraintes et objectifs

**Dures** (toujours respectées) : compétence, disponibilités, absences, interdictions, verrous, pas de chevauchement ni de repos insuffisant (y compris autour d'une nuit), plafond par jour et par semaine, jours d'affilée, effectif maximal.

**Objectifs**, par ordre d'importance (poids dans `solver/src/problem.ts`) :
1. **Couvrir** les places requises (10 000 × priorité du besoin par place).
2. **Occuper** : durée hebdomadaire visée (écart en moins 40/quart d'heure, en plus 20 ; au prorata des semaines partielles et des absences). Les places au-delà du requis (jusqu'au maximum) servent à occuper les personnes sous-employées, avec un léger coût (50).
3. **Équité** : minimiser la charge de la personne la plus chargée en vacations pénibles.
4. **Stabilité** : conserver le planning de référence (mode « changer le moins possible »).
5. **Souhaits** : jours/besoins préférés ou évités, jours libres.

## 5. Limites connues

- Vacations à horaires fixes (pas de découpage libre de la journée).
- Pas de mémoire entre périodes : les jours d'affilée et heures de la semaine à cheval sur deux périodes ne sont pas reliés.
- Règles par défaut indicatives, à vérifier au regard de la convention applicable.
- Pas de cycles de rotation imposés ni de répartition équitable des heures entre personnes sans durée visée.

## 6. Vocabulaire

| Concept | Terme |
|---|---|
| Personne à placer | **Ressource** |
| Vacation à pourvoir (récurrente) | **Besoin** |
| Une vacation un jour donné | **Vacation** (occurrence) |
| Résultat | **Planning** |
| Tranche à générer | **Période** |
| Place non pourvue | **Place vide** |
