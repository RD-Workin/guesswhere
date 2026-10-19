# GuessWhere

Un « GeoGuessr » avec ses propres photos de voyage iPhone. Une photo s'affiche, on touche la carte à l'endroit supposé, et le score dépend de la distance (de la ville au continent).

- Web app installable (Safari iPhone, « Sur l'écran d'accueil »).
- **Tout reste sur le téléphone** : la position GPS est lue dans le navigateur, chaque image est ré-encodée sans métadonnées, la carte est embarquée, aucune requête vers un tiers. Un bouton efface tout.
- Ce dépôt ne contient que du code. Les images de `test/fixtures/` sont des dégradés générés, avec des positions fictives.
- Gratuit : hébergé sur GitHub Pages, aucun service payant.

## Développement

```sh
npm install
npm run dev        # serveur local
npm test           # tests unitaires (distance, score, voyages, pays…)
npm run test:e2e   # parcours complet dans Chromium au format iPhone
```

Les décisions d'architecture sont tenues dans le projet Claude « GuessWhere » (`decisions.md`).
