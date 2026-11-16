# Mise en ligne

Le site est **statique** : l'application (HTML, JavaScript, WebAssembly) et l'archive du compagnon. Aucune donnée utilisateur n'y transite.

Adresse prévue : `https://planning.potodugoud.fr` (un **sous-domaine** plutôt qu'un chemin `potodugoud.fr/planning` : chaque sous-domaine est une « origine » distincte, donc le stockage du navigateur de l'application est isolé du reste du site, et le compagnon n'autorise qu'une origine précise).

## 1. Construire

```bash
npm install
npm run build:site
```

Produit `packages/app/dist/` : c'est tout ce qu'il faut publier. Il contient `index.html`, `assets/` (dont `highs-*.wasm`, le moteur de calcul) et `compagnon.zip`.

## 2. DNS et HTTPS

- Créer l'enregistrement DNS `planning` (A/AAAA vers le serveur, ou CNAME).
- Le certificat est obtenu automatiquement par Caddy dès que le DNS pointe vers le serveur (ne servir **qu'en HTTPS**).

## 3. Serveur web (Caddy)

Le serveur utilise déjà Caddy, qui obtient et renouvelle seul le certificat HTTPS. Copier `dist` dans `/var/www/planning`, puis ajouter à `/etc/caddy/Caddyfile` le bloc de [deploy/Caddyfile.planning](deploy/Caddyfile.planning) (en-têtes de sécurité, politique CSP, cache) et recharger :

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Cette politique (CSP) a été testée sur le site construit : le calcul dans le navigateur et via le compagnon fonctionnent, sans erreur dans la console.

## 4. Compagnon

L'utilisateur télécharge `compagnon.zip` depuis la page (aide « Qu'est-ce que le compagnon ? »), le décompresse et lance le lanceur généré par la page, qui exécute :

```
node companion.mjs --origin https://planning.potodugoud.fr
```

Le compagnon n'écoute que `127.0.0.1:47821` et n'accepte que cette origine.

## 5. À vérifier après la mise en ligne

1. La page s'ouvre en HTTPS, « Charger l'exemple » puis « Générer le planning » donne « Planning optimal ».
2. Console du navigateur sans erreur (en particulier de politique de sécurité).
3. `compagnon.zip` se télécharge ; une fois décompressé et lancé, « Rechercher le compagnon » le détecte et un calcul passe par lui.
4. Rechargement de la page : les données sont conservées (stockage du navigateur) ; l'onglet « À propos » est lisible.

## Limites connues

- **Compagnon et navigateurs** : vérifié de bout en bout dans Chrome sur `https://planning.potodugoud.fr` (détection, choix du solveur, calcul avec `compagnon.exe`). Non vérifié dans Firefox, Edge et Safari ; Safari peut bloquer l'accès d'une page HTTPS à `http://127.0.0.1`. Le navigateur intégré à l'outil de développement le bloque aussi, ce qui ne reflète pas Chrome.
- **Avertissement Windows** : le lanceur `.cmd` n'est pas signé ; Windows peut afficher un avertissement au premier lancement (expliqué dans la page).
- **Pas de mises à jour automatiques** du compagnon : si le protocole change, la page ne le détectera plus et l'utilisateur devra retélécharger l'archive.
- **HiGHS natif** : vérifié avec l'exécutable officiel 1.16.0 sous Windows (voir `packages/companion/README.md`) ; non fourni avec `compagnon.exe`, à installer à part si on veut l'utiliser.


## État du déploiement

Pas encore déployé. Le port du compagnon (47822) et son nom diffèrent de ceux de « La planif » pour que les deux puissent tourner ensemble.
