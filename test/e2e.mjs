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

  // Photos stockées chiffrées, chacune avec sa clé non exportable : ni image, ni position, ni pays, ni nom de fichier en clair.
  const stored = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('guesswhere'); q.onsuccess = () => r(q.result); });
    const get = (name) => new Promise((r) => { const q = db.transaction(name).objectStore(name).getAll(); q.onsuccess = () => r(q.result); });
    const [all, keys] = [await get('photos'), await get('cles')];
    db.close();
    return {
      keys: keys.map((k) => k.key.extractable),
      photos: all.map((p) => {
        const text = new TextDecoder('latin1').decode(p.data);
        return { fields: Object.keys(p).sort().join(), keyFound: keys.some((k) => k.id === p.id), clear: /Exif\0|Apple|iPhone|Japon|Brésil|tokyo|JFIF/.test(text + JSON.stringify(p)) };
      }),
    };
  });
  assert.deepEqual(stored.keys, [false, false], 'clés non exportables');
  for (const s of stored.photos) {
    assert.equal(s.fields, 'data,id,iv');
    assert.equal(s.keyFound, true);
    assert.equal(s.clear, false, 'donnée en clair dans le stockage');
  }
  // Une fois déchiffrées, les photos gardent leur pays.
  await page.getByText('Continuer').click();
  await page.getByText('Mes voyages').click();
  await page.getByText('Japon', { exact: false }).first().waitFor();
  await page.getByText('Brésil', { exact: false }).first().waitFor();
  await page.getByRole('button', { name: 'Retour' }).click();

  // Partie solo de 2 manches.
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
  // Premier duel : conseil Accès guidé, montré une seule fois.
  await page.getByText('Compris, on joue').click();
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

  // Migration : une photo enregistrée avant le chiffrement (en clair) est chiffrée à l'ouverture suivante.
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(40, 30);
    c.getContext('2d').fillRect(0, 0, 40, 30);
    const blob = await c.convertToBlob({ type: 'image/jpeg' });
    const db = await new Promise((r) => { const q = indexedDB.open('guesswhere'); q.onsuccess = () => r(q.result); });
    const tx = db.transaction(['photos', 'recus'], 'readwrite');
    tx.objectStore('photos').put({ id: 'ancienne', blob, lat: 48.8584, lng: 2.2945, takenAt: Date.UTC(2020, 5, 1), countryId: '250', countryName: 'France', addedAt: Date.now() });
    // Une partie reçue en cours : elle doit survivre à la perte d'une clé.
    tx.objectStore('recus').put({ id: 'recue', file: new Blob(['x']), code: '', from: 'Zoé', player: 'Moi', expiresAt: Date.now() + 864e5, guesses: [] });
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  });
  await page.reload();
  await page.getByText('3 photos prêtes à jouer').waitFor();
  const migrated = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('guesswhere'); q.onsuccess = () => r(q.result); });
    const p = await new Promise((r) => { const q = db.transaction('photos').objectStore('photos').get('ancienne'); q.onsuccess = () => r(q.result); });
    db.close();
    return Object.keys(p).sort().join();
  });
  assert.equal(migrated, 'data,id,iv', 'photo ancienne chiffrée');

  // Clé perdue (restauration de l'iPhone) : pas de plantage, « Réimporter », parties reçues gardées.
  await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('guesswhere'); q.onsuccess = () => r(q.result); });
    const tx = db.transaction('cles', 'readwrite');
    tx.objectStore('cles').delete('ancienne');
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  });
  await page.reload();
  await page.getByText('1 photo illisible').waitFor();
  await page.getByText('2 photos prêtes à jouer').waitFor();
  await page.getByText('Reprendre la partie de Zoé').waitFor();
  await page.getByRole('button', { name: 'Réimporter' }).click();
  await page.getByText('Photos illisibles retirées').waitFor();
  assert.equal(await page.getByText('photo illisible').count(), 0);
  await page.getByText('Reprendre la partie de Zoé').waitFor();
  await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('guesswhere'); q.onsuccess = () => r(q.result); });
    const tx = db.transaction(['recus', 'photos', 'cles'], 'readwrite');
    tx.objectStore('recus').delete('recue');
    const left = await new Promise((r) => { const q = tx.objectStore('photos').count(); q.onsuccess = () => r(q.result); });
    const keys = await new Promise((r) => { const q = tx.objectStore('cles').count(); q.onsuccess = () => r(q.result); });
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
    if (left !== 2 || keys !== 2) throw new Error(`après Réimporter : ${left} photos, ${keys} clés`);
  });
  await page.reload();

  // Test du chiffrement : clé non exportable conservée après rechargement, puis nettoyage.
  await page.getByText('Réglages et confidentialité').click();
  await page.getByRole('button', { name: 'Tester le chiffrement' }).click();
  await page.getByRole('button', { name: 'Lancer le test' }).click();
  await page.getByText('Étape 1 réussie').waitFor();
  await page.reload();
  await page.getByText('Réglages et confidentialité').click();
  await page.getByRole('button', { name: 'Tester le chiffrement' }).click();
  await page.getByText('Images déchiffrées après réouverture : oui').waitFor();
  await page.getByText('Clé impossible à extraire : oui').waitFor();
  await page.getByRole('button', { name: 'Nettoyer le test' }).click();
  await page.getByRole('button', { name: 'Lancer le test' }).waitFor();
  await page.getByRole('button', { name: 'Retour' }).click();

  // Tout supprimer (appui long de 2 s).
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
