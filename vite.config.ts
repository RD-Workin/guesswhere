import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Politique de sécurité du contenu, injectée seulement dans la version publiée
// (le serveur de dev de Vite a besoin de styles en ligne). Une balise <meta>
// suffit pour un hébergement statique qui ne permet pas d'en-têtes HTTP.
// Tout vient de la même origine : aucun script, police ou tuile d'un tiers.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "child-src blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// Injecte dans le service worker la liste complète des fichiers publiés et une
// version qui change à chaque compilation différente : l'app entière (carte,
// frontières, worker MapLibre, icônes) est préchargée pour jouer hors ligne.
const precache = (): Plugin => {
  let files: string[] = [];
  let outDir = 'dist';
  return {
    name: 'precache',
    apply: 'build',
    configResolved: (c) => { outDir = c.build.outDir; },
    generateBundle: (_, bundle) => { files = Object.keys(bundle); },
    closeBundle: () => {
      const publicFiles = ['manifest.webmanifest', 'icone.svg', 'icone-180.png', 'icone-512.png'];
      const list = ['./', ...[...files, ...publicFiles].filter((f) => f !== 'index.html').map((f) => `./${f}`)];
      const version = createHash('sha256').update(list.join()).digest('hex').slice(0, 12);
      const sw = join(outDir, 'sw.js');
      writeFileSync(sw, `self.__PRECACHE__ = ${JSON.stringify(list)};\nself.__VERSION__ = '${version}';\n` + readFileSync(sw, 'utf8'));
    },
  };
};

// base relatif : l'app fonctionne à la racine d'un domaine comme dans un
// sous-dossier (ex. GitHub Pages /guesswhere/).
export default defineConfig({
  base: './',
  build: { target: 'safari16' },
  plugins: [csp(), precache()],
});
