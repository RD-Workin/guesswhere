// Vue satellite : téléchargement en un seul morceau depuis les Réglages,
// affichage dans la partie, retrait. Archive de test : tuiles factices z0-3
// produites par scripts/satellite.py à partir d'images générées.
import { chromium, devices } from 'playwright-core';
import { spawn } from 'child_process';
import { cpSync, mkdirSync } from 'fs';
import assert from 'assert/strict';

mkdirSync('dist/carte', { recursive: true });
cpSync('test/fixtures/satellite', 'dist/carte', { recursive: true });
const server = spawn('node_modules/.bin/vite', ['preview', '--port', '4193', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('4193') && r()));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
const ctx = await browser.newContext({ ...iphone, isMobile: false });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));
const archive = [];
page.on('request', (r) => r.url().includes('monde.pmtiles') && archive.push(r.headers().range ?? 'entier'));

try {
  await page.goto('http://localhost:4193/');
  await page.getByText('Aucune photo').waitFor();
  await page.locator('input[type=file]').first().setInputFiles(['tokyo', 'rio'].map((f) => `test/fixtures/${f}.jpg`));
  await page.getByText('Import terminé').waitFor();
  await page.getByText('Continuer').click();

  // Sans téléchargement, la carte dessinée seule.
  await page.getByText('Réglages et confidentialité').click();
  await page.getByText('à télécharger, de préférence en Wi-Fi').waitFor();
  await page.getByRole('button', { name: 'Télécharger la vue satellite' }).click();
  await page.getByText('Vue satellite installée sur ce téléphone.').waitFor();
  assert.deepEqual(archive, ['entier'], 'archive téléchargée en entier, une seule fois');

  await page.getByRole('button', { name: 'Retour' }).click();
  await page.getByRole('button', { name: 'Jouer', exact: true }).click();
  await page.locator('#manches').fill('1');
  await page.getByText('Commencer').click();
  await page.getByText('Manche 1/1').waitFor();
  await page.locator('.maplibregl-ctrl-attrib').getByText('NASA Blue Marble', { exact: false }).waitFor({ state: 'attached' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test/out-satellite.png' });
  assert.deepEqual(archive, ['entier'], 'aucune requête réseau pour les tuiles');
  await page.locator('.carte').click({ position: { x: 150, y: 120 } });
  await page.getByRole('button', { name: 'Valider' }).click();
  await page.locator('.resultats').waitFor();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Quitter la partie' }).click().catch(() => {});

  await page.goto('http://localhost:4193/');
  await page.getByText('Réglages et confidentialité').click();
  await page.getByRole('button', { name: 'Retirer la vue satellite' }).click();
  await page.getByText('à télécharger, de préférence en Wi-Fi').waitFor();
  assert.equal((await page.evaluate(() => caches.keys())).includes('carte-satellite'), false);
  assert.deepEqual(problems, [], 'erreurs console / CSP');
  console.log('E2E satellite OK');
} catch (e) { await page.screenshot({ path: 'test/out-echec.png', timeout: 5000 }).catch(() => {}); console.log(problems); throw e;
} finally {
  await browser.close();
  process.kill(-server.pid);
}
