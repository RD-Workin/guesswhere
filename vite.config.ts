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

// base relatif : l'app fonctionne à la racine d'un domaine comme dans un
// sous-dossier (ex. GitHub Pages /guesswhere/).
export default defineConfig({
  base: './',
  build: { target: 'safari16' },
  plugins: [csp()],
});
