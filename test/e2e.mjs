// Parcours complet dans Chromium (format iPhone) sur la version publiée :
// import, nettoyage des métadonnées, partie solo et duel, suppression totale.
import { existsSync } from 'fs';
import { chromium, devices } from 'playwright-core';
import { spawn } from 'child_process';
import assert from 'assert/strict';

const server = spawn('node_modules/.bin/vite', ['preview', '--port', '4191', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('4191') && r()));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined) });
const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
const ctx = await browser.newContext({ ...iphone, isMobile: false });
const page = await ctx.newPage();
// Simule l'app installée sur l'écran d'accueil (l'import y est réservé).
await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => !sessionStorage.getItem('onglet') }));
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));
const thirdParty = [];
page.on('request', (r) => !r.url().startsWith('http://localhost:4191') && !r.url().startsWith('blob:') && !r.url().startsWith('data:') && thirdParty.push(r.url()));

try {
  // Dans un simple onglet Safari : pas d'import, tutoriel d'installation.
  await page.goto('http://localhost:4191/');
  await page.evaluate(() => sessionStorage.setItem('onglet', '1'));
  await page.reload();
  await page.getByText('Installe d’abord GuessWhere').waitFor();
  assert.equal(await page.locator('input[type=file]').count(), 0);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByText('Aucune photo').waitFor();
  await page.locator('input[type=file]').first().setInputFiles(['tokyo', 'rio', 'sans-gps', 'zero'].map((f) => `test/fixtures/${f}.jpg`));
  await page.getByText('Import terminé').waitFor();
  const bilan = await page.locator('.bilan').innerText();
  assert.match(bilan, /2 photos ajoutées/);
  assert.match(bilan, /2 photos ignorées/);
  await page.getByText('2 photos sans position').waitFor();
  await page.getByText('Réessayer').waitFor();

  // Aucune métadonnée dans les images stockées, aucun nom de fichier d'origine.
  const stored = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('guesswhere'); q.onsuccess = () => r(q.result); });
    const all = await new Promise((r) => { const q = db.transaction('photos').objectStore('photos').getAll(); q.onsuccess = () => r(q.result); });
    db.close();
    return Promise.all(all.map(async (p) => {
      const bytes = new Uint8Array(await p.blob.arrayBuffer());
      const text = new TextDecoder('latin1').decode(bytes);
      return { keys: Object.keys(p).sort().join(), country: p.countryName, type: p.blob.type, app1: text.includes('Exif\0'), apple: text.includes('Apple') || text.includes('iPhone'), name: JSON.stringify(p).includes('tokyo') };
    }));
  });
  for (const s of stored) {
    assert.equal(s.type, 'image/jpeg');
    assert.equal(s.app1, false, 'EXIF présent dans l’image stockée');
    assert.equal(s.apple, false, 'modèle d’appareil présent');
    assert.equal(s.name, false, 'nom de fichier conservé');
  }
  assert.deepEqual(stored.map((s) => s.country).sort(), ['Brésil', 'Japon']);

  // Partie solo de 2 manches.
  await page.getByText('Continuer').click();
  await page.getByRole('button', { name: 'Jouer', exact: true }).click();
  await page.locator('#manches').fill('2');
  await page.getByText('Commencer').click();
  for (let i = 0; i < 2; i++) {
    await page.getByText(`Manche ${i + 1}/2`).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Valider' }).isVisible(), false);
    await page.locator('.carte').click({ position: { x: 150, y: 120 } });
    await page.getByRole('button', { name: 'Valider' }).click();
    await page.locator('.resultats').waitFor();
    assert.match(await page.locator('.resultats').innerText(), /points/);
    assert.equal(await page.locator('.consigne').count(), 0);
    await page.locator('.barre .principal').click();
  }
  await page.getByText('Fin de partie').waitFor();
  await page.screenshot({ path: 'test/out-fin.png' });

  // Paysage : photo et carte côte à côte.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByText('Rejouer').click();
  await page.getByText('Manche 1/2').waitFor();
  const [photoBox, mapBox] = [await page.locator('.cadre-photo').boundingBox(), await page.locator('.carte').boundingBox()];
  assert.ok(mapBox.x >= photoBox.x + photoBox.width - 1, 'paysage : carte à droite de la photo');
  await page.screenshot({ path: 'test/out-paysage.png' });
  await page.setViewportSize({ width: 390, height: 664 });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Quitter la partie' }).click();
  await page.getByRole('button', { name: 'Jouer', exact: true }).waitFor();

  // Duel : écran de passage entre les joueurs.
  await page.getByRole('button', { name: 'Jouer', exact: true }).click();
  await page.locator('#manches').fill('1');
  await page.locator('#duel').check();
  await page.locator('#j1').fill('Léa');
  await page.locator('#j2').fill('Tom');
  await page.getByText('Commencer').click();
  await page.getByText('Léa · Manche 1/1').waitFor();
  await page.locator('.carte').click({ position: { x: 100, y: 100 } });
  await page.screenshot({ path: 'test/out-manche.png' });
  await page.getByRole('button', { name: 'Valider' }).click();
  await page.getByText('Passe le téléphone à Tom').waitFor();
  assert.equal(await page.locator('.carte .repere').count(), 0, 'le repère de Léa reste visible');
  await page.getByText('C’est moi, je joue').click();
  await page.getByText('Tom · Manche 1/1').waitFor();
  await page.locator('.carte').click({ position: { x: 200, y: 150 } });
  await page.getByRole('button', { name: 'Valider' }).click();
  await page.locator('.resultats').waitFor();
  assert.match(await page.locator('.resultats').innerText(), /Léa : .*\n?Tom : /s);
  assert.equal(await page.locator('.carte .repere').count(), 3);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test/out-revelation.png' });
  await page.locator('.barre .principal').click();
  await page.getByText('Fin de partie').waitFor();

  // Tout supprimer (appui long de 2 s).
  await page.getByText('Accueil').click();
  await page.getByText('Réglages et confidentialité').click();
  await page.getByRole('button', { name: 'Tout supprimer' }).click();
  const btn = page.getByText('Maintenir 2 secondes');
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(2300);
  await page.mouse.up();
  await page.getByText('Tout a été supprimé (2 photos, 2 voyages)').waitFor();
  await page.reload();
  await page.getByText('Aucune photo').waitFor();

  // Suppression sans appui long (VoiceOver) : deux clics.
  await page.getByText('Réglages et confidentialité').click();
  await page.getByRole('button', { name: 'Tout supprimer' }).click();
  await page.getByText('Confirmer sans maintenir').click();
  await page.getByText('Oui, tout supprimer').click();
  await page.getByText('Tout a été supprimé').waitFor();

  await page.goto('http://localhost:4191/');
  const count = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('guesswhere'); q.onsuccess = () => { const db = q.result; if (!db.objectStoreNames.contains('photos')) { db.close(); return r(0); } const c = db.transaction('photos').objectStore('photos').count(); c.onsuccess = () => { db.close(); r(c.result); }; }; }));
  assert.equal(count, 0);
  // Cache hors ligne et service worker eux aussi supprimés (le rechargement a pu réinscrire le SW : on vérifie juste après la suppression).
  await page.getByText('Réglages et confidentialité').click();
  await page.getByRole('button', { name: 'Tout supprimer' }).click();
  await page.getByText('Confirmer sans maintenir').click();
  await page.getByText('Oui, tout supprimer').click();
  await page.getByText('Tout a été supprimé').waitFor();
  const leftovers = await page.evaluate(async () => ({ caches: await caches.keys(), sw: (await navigator.serviceWorker.getRegistrations()).length }));
  assert.deepEqual(leftovers, { caches: [], sw: 0 });

  // Refus d'affichage dans une page tierce : une page d'une autre origine intègre l'app.
  await ctx.route('http://hote.test/', (r) => r.fulfill({ contentType: 'text/html', body: '<iframe src="http://app.test/" width="300" height="300"></iframe>' }));
  await ctx.route('http://app.test/**', async (r) => r.fulfill({ response: await r.fetch({ url: r.request().url().replace('http://app.test', 'http://localhost:4191') }) }));
  await page.goto('http://hote.test/');
  await page.frameLocator('iframe').getByText('ne peut pas être affiché').waitFor();
  assert.equal(await page.frameLocator('iframe').locator('button').count(), 0);
  problems.splice(0, problems.length, ...problems.filter((m) => !m.includes('iframe')));
  thirdParty.splice(0, thirdParty.length, ...thirdParty.filter((u) => !u.includes('.test/')));
  assert.deepEqual(thirdParty, [], 'requêtes vers un tiers : ' + thirdParty.join(', '));
  assert.deepEqual(problems, [], 'erreurs console / CSP');
  console.log('E2E OK');
} catch (e) { await page.screenshot({ path: "test/out-echec.png", timeout: 5000 }).catch(() => {}); console.log(problems); throw e;
} finally {
  await browser.close();
  process.kill(-server.pid);
}
