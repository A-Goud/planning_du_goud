# Compagnon de calcul

Petit serveur local (Node.js) qui résout les modèles d'optimisation à la place du navigateur.

```
npm run build -w @planning/companion          # produit packages/companion/dist
node dist/companion.mjs --origin https://<le site>   # --dev pour http://localhost:5173
```

- Écoute uniquement `127.0.0.1` (port 47822 par défaut) ; refuse tout `Host` non local et toute `Origin` hors liste blanche.
- Moteur : exécutable HiGHS natif s'il est trouvé (`--highs <chemin>` ou `highs` dans le PATH), sinon HiGHS WebAssembly dans un processus séparé.
- Un seul calcul à la fois ; annuler dans le navigateur arrête le calcul.
- `npm run build:exe -w @planning/companion` produit `compagnon.exe` (Node + programme + HiGHS, ~95 Mo, Windows) dans `packages/app/public/`. Sans option, il autorise `https://planning.potodugoud.fr`. Le calcul tourne dans un second processus (le même exécutable relancé avec `--solve-child`) ; annuler dans le navigateur le tue. L'exécutable n'est pas signé (avertissement SmartScreen).
- `dist/` est autonome : copier le dossier entier (il contient `node_modules/highs`).

HiGHS natif a été vérifié avec l'exécutable officiel HiGHS 1.16.0 (Windows, `highs-1.16.0-x86_64-windows-static-mit.zip`) : même optimum que le WebAssembly, annulation comprise. Pour le tester : `HIGHS_BIN=<chemin de highs.exe> npm test -w @planning/companion`. Pour l'utiliser : `compagnon.exe --highs <chemin de highs.exe>` (ou `highs` dans le PATH). HiGHS 1.16 n'accepte pas `--mip_rel_gap` en ligne de commande : le gap et le temps passent par un fichier d'options.
