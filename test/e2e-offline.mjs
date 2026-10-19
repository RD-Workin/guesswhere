// Tout le jeu sans connexion, une fois l'app chargée une première fois :
// import, partie solo, duel, envoi à un ami, partie reçue, lecture du résultat.
import { chromium, devices } from 'playwright-core';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import assert from 'assert/strict';

const PORT = 4194;
const server = spawn('node_modules/.bin/vite', ['preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes(String(PORT)) && r()));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
const ctx = await browser.newContext({ ...iphone, isMobile: false, acceptDownloads: true });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));

const playRound = async (label, x, y) => {
  await page.getByText(label).waitFor();
  await page.locator('.carte').click({ position: { x, y } });
  await page.getByRole('button', { name: 'Valider' }).click();
};

try {
  // Première visite en ligne : le service worker précharge tout.
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  // Coupure réseau.
  await ctx.setOffline(true);
  await page.reload();
  await page.getByText('Aucune photo').waitFor();

  await page.locator('input[type=file]').first().setInputFiles(['test/fixtures/tokyo.jpg', 'test/fixtures/rio.jpg']);
  await page.getByText('Import terminé').waitFor();
  await page.getByText('Continuer').click();

  // Solo.
  await page.getByRole('button', { name: 'Jouer', exact: true }).click();
  await page.locator('#manches').fill('1');
  await page.getByText('Commencer').click();
  await playRound('Manche 1/1', 120, 100);
  await page.locator('.resultats').waitFor();
  assert.ok(await page.locator('.carte canvas').isVisible(), 'carte affichée hors ligne');
  await page.locator('.barre .principal').click();
  await page.getByText('Fin de partie').waitFor();

  // Duel.
  await page.getByText('Accueil').click();
  await page.getByRole('button', { name: 'Jouer', exact: true }).click();
  await page.locator('#manches').fill('1');
  await page.locator('#duel').check();
  await page.getByText('Commencer').click();
  await playRound('Joueur 1 · Manche 1/1', 100, 100);
  await page.getByText('C’est moi, je joue').click();
  await playRound('Joueur 2 · Manche 1/1', 200, 150);
  await page.locator('.barre .principal').click();
  await page.getByText('Fin de partie').waitFor();

  // Envoi à un ami : fichier chiffré + code.
  await page.getByText('Accueil').click();
  await page.getByRole('button', { name: 'Jouer', exact: true }).click();
  await page.locator('#manches').fill('2');
  await page.locator('#j1').fill('Romain');
  await page.getByText('Envoyer à un ami').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByText('Envoyer le fichier').click()]);
  assert.equal(download.suggestedFilename(), 'partie.guesswhere');
  const filePath = await download.path();
  const raw = readFileSync(filePath).toString('latin1');
  assert.ok(raw.startsWith('GWH1') && !raw.includes('Romain') && !raw.includes('Exif'), 'fichier chiffré');
  const code = (await page.locator('.code').innerText()).replace(/\s/g, '');
  assert.equal(code.length, 26);
  await page.getByText('Terminé').click();

  // L'ami ouvre la partie reçue (ici sur le même téléphone, toujours hors ligne).
  await page.getByText('Jouer une partie reçue').click();
  await page.locator('input[type=file]').setInputFiles({ name: 'partie.guesswhere', mimeType: 'application/octet-stream', buffer: readFileSync(filePath) });
  await page.locator('#code').fill('mauvais code');
  await page.getByRole('button', { name: 'Jouer', exact: true }).click();
  await page.getByText('Code invalide').waitFor();
  await page.locator('input[type=file]').setInputFiles({ name: 'partie.guesswhere', mimeType: 'application/octet-stream', buffer: readFileSync(filePath) });
  await page.locator('#code').fill(code.toLowerCase().replace(/(.{5})/g, '$1 '));
  await page.locator('#prenom').fill('Léa');
  await page.getByRole('button', { name: 'Jouer', exact: true }).click();
  await playRound('Manche 1/2', 120, 100);
  await page.locator('.barre .principal').click();
  await playRound('Manche 2/2', 200, 160);
  await page.locator('.barre .principal').click();
  await page.getByText('Renvoie ce code à Romain').waitFor();
  const result = await page.locator('.code').innerText();
  assert.match(result, /^GWR1-/);
  await page.getByText('Accueil').click();

  // Romain lit le résultat.
  await page.getByText('Lire le résultat d’un ami').click();
  await page.locator('#resultat').fill(`Voilà ! ${result}`);
  await page.getByText('Voir le résultat').click();
  await page.getByText('Résultat de Léa').waitFor();
  assert.equal(await page.locator('.bilan li').count(), 2);

  assert.deepEqual(problems.filter((p) => !p.includes('ERR_INTERNET_DISCONNECTED')), [], 'erreurs hors ligne');
  console.log('E2E HORS LIGNE OK');
} catch (e) {
  await page.screenshot({ path: 'test/out-echec-hors-ligne.png', timeout: 5000 }).catch(() => {});
  console.log(problems);
  throw e;
} finally {
  await browser.close();
  process.kill(-server.pid);
}
