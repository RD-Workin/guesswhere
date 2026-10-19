import './style.css';
import { addPhoto, allPhotos, deleteReceivedGame, getSentGame, purgeExpiredReceived, receivedGames, requestPersistence, saveReceivedGame, saveSentGame, wipeEverything, type ReceivedGame } from './db';
import { advance, currentPhoto, newGame, submitGuess, totals, DEFAULT_ROUNDS, type Game } from './game';
import { distanceKm, formatDistance, type LatLng } from './geo';
import { GameMap } from './map';
import { importFile, readExif, type Photo } from './photos';
import { MAX_SCORE, roundScore } from './score';
import { decodeResult, encodeResult, newShareCode, packGame, unpackGame, MAX_SHARED_PHOTOS, SHARE_FILE_NAME, SHARE_TTL_MS } from './share';
import { groupIntoTrips } from './trips';
import { h, nf, plural, screen } from './ui';

const PLAYER_COLORS = ['#0A84FF', '#FF9F0A'];
const ANSWER_COLOR = '#30D158';

const isInstalled = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/**
 * Sur iOS, l'app installée et l'onglet Safari ont deux stockages séparés :
 * des photos importées dans Safari n'apparaîtraient pas dans l'app installée
 * (décision C11). L'import n'est donc possible que dans l'app installée.
 */
const canImport = () => isInstalled() || import.meta.env.DEV;

const photoUrls = new Map<string, string>();
function urlFor(p: Photo): string {
  let u = photoUrls.get(p.id);
  if (!u) photoUrls.set(p.id, (u = URL.createObjectURL(p.blob)));
  return u;
}

const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

interface Trip {
  name: string;
  photos: Photo[];
}

function tripsOf(photos: Photo[]): Trip[] {
  // Les photos sans date EXIF ne sont pas rangées par date : elles fausseraient les voyages.
  const undated = photos.filter((p) => p.undated);
  const trips = groupIntoTrips(photos.filter((p) => !p.undated)).map((ps) => {
    const counts = new Map<string, number>();
    for (const p of ps) if (p.countryName) counts.set(p.countryName, (counts.get(p.countryName) ?? 0) + 1);
    const country = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Voyage';
    return { name: `${country} · ${monthFmt.format(ps[0].takenAt)}`, photos: ps };
  }).reverse();
  return undated.length ? [...trips, { name: 'Photos sans date', photos: undated }] : trips;
}

function countriesOf(photos: Photo[]): Trip[] {
  const by = new Map<string, Photo[]>();
  for (const p of photos) {
    const k = p.countryName ?? 'Pays inconnu';
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  return [...by].map(([name, ps]) => ({ name, photos: ps })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

// ---------- Accueil ----------

async function home(message?: string) {
  await purgeExpiredReceived();
  const photos = await allPhotos();
  const pending = await receivedGames();
  screen(
    h('header', { class: 'titre' }, h('h1', {}, 'GuessWhere'), h('p', { class: 'badge' }, 'Sur ton iPhone uniquement')),
    message && h('p', { class: 'info', role: 'status' }, message),
    !canImport() && h('section', { class: 'bandeau' },
      h('p', {}, h('strong', {}, 'Installe d’abord GuessWhere sur ton écran d’accueil.')),
      h('ol', {},
        h('li', {}, 'Touche le bouton Partager de Safari (le carré avec une flèche).'),
        h('li', {}, 'Choisis « Sur l’écran d’accueil », puis « Ajouter ».'),
        h('li', {}, 'Ouvre GuessWhere depuis sa nouvelle icône et importe tes photos.'),
      ),
      h('p', {}, 'Tes photos sont gardées seulement sur cet iPhone, dans l’app installée. Dans un simple onglet, Safari pourrait les effacer.'),
    ),
    h('p', {}, photos.length
      ? `${plural(photos.length, 'photo', 'photos')} prête${photos.length > 1 ? 's' : ''} à jouer.`
      : 'Aucune photo pour l’instant. Importe des photos de voyage : seules leur position et leur date sont lues, ici même.'),
    h('div', { class: 'actions' },
      photos.length > 0 && h('button', { class: 'principal', onclick: () => setup(photos) }, 'Jouer'),
      canImport() && importButton(),
      photos.length > 0 && h('button', { onclick: () => library(photos) }, 'Mes voyages'),
      ...pending.map((g) => h('button', { onclick: () => playReceived(g) }, `Reprendre la partie de ${g.from}`)),
      h('button', { onclick: () => openReceived() }, 'Jouer une partie reçue'),
      h('button', { onclick: () => readResult() }, 'Lire le résultat d’un ami'),
      h('button', { class: 'discret', onclick: () => settings() }, 'Réglages et confidentialité'),
    ),
  );
}

/**
 * Sélecteur de photos. Accepter explicitement le HEIC fait livrer par Safari
 * l'original (plus léger, GPS conservé) au lieu d'un JPEG converti (test iOS 18.7).
 */
function importButton(label = 'Importer des photos', primary = false): HTMLElement {
  const input = h('input', { type: 'file', accept: '.heic,.heif,image/*', multiple: true, hidden: true });
  input.addEventListener('change', () => input.files?.length && runImport([...input.files]));
  return h('label', { class: primary ? 'bouton principal' : 'bouton' }, label, input);
}

async function runImport(files: File[]) {
  const progress = h('progress', { max: files.length, value: 0 });
  const label = h('p', {}, `Lecture de ${plural(files.length, 'photo', 'photos')}…`);
  screen(h('h2', {}, 'Import'), label, progress);
  let ok = 0, noGps = 0, errors = 0;
  // Une photo à la fois : Safari iOS limite fortement la mémoire des canvas.
  for (const [i, f] of files.entries()) {
    const r = await importFile(f);
    if (r.kind === 'ok') { await addPhoto(r.photo); ok++; }
    else if (r.kind === 'no-gps') noGps++;
    else errors++;
    progress.value = i + 1;
  }
  if (ok) await requestPersistence();
  screen(
    h('h2', {}, 'Import terminé'),
    h('ul', { class: 'bilan' },
      h('li', {}, `${plural(ok, 'photo ajoutée', 'photos ajoutées')} avec leur position`),
      noGps > 0 && h('li', {}, `${plural(noGps, 'photo ignorée', 'photos ignorées')} : pas de position`),
      errors > 0 && h('li', {}, `${plural(errors, 'photo illisible', 'photos illisibles')}`),
    ),
    noGps > 0 && h('p', { class: 'bandeau' },
      `${plural(noGps, 'photo', 'photos')} sans position. Dans le sélecteur, touche « Options » et vérifie que « Localisation » est activée.`),
    h('p', { class: 'badge' }, 'Les images ont été réduites et nettoyées de leurs métadonnées. Les originaux ne sont pas conservés.'),
    h('div', { class: 'actions' },
      noGps > 0 && importButton('Réessayer'),
      h('button', { class: 'principal', onclick: () => home() }, 'Continuer'),
    ),
  );
}

function library(photos: Photo[]) {
  screen(
    h('h2', {}, 'Mes voyages'),
    h('p', { class: 'badge' }, 'Sur ton iPhone uniquement'),
    ...tripsOf(photos).map((t) => h('section', { class: 'voyage' },
      h('h3', {}, t.name, h('small', {}, ` ${plural(t.photos.length, 'photo', 'photos')}`)),
      h('div', { class: 'vignettes' }, ...t.photos.slice(0, 12).map((p) => h('img', { src: urlFor(p), alt: '', loading: 'lazy' }))),
    )),
    h('div', { class: 'actions' }, h('button', { onclick: () => home() }, 'Retour')),
  );
}

// ---------- Nouvelle partie ----------

function setup(photos: Photo[]) {
  const selections: Trip[] = [{ name: 'Toutes les photos', photos }, ...tripsOf(photos), ...countriesOf(photos)];
  const select = h('select', { id: 'selection' },
    h('option', { value: '0' }, `Toutes les photos (${nf(photos.length)})`),
    h('optgroup', { label: 'Par voyage' }, ...tripsOf(photos).map((t, i) => h('option', { value: String(1 + i) }, `${t.name} (${nf(t.photos.length)})`))),
    h('optgroup', { label: 'Par pays' }, ...countriesOf(photos).map((t, i) => h('option', { value: String(1 + tripsOf(photos).length + i) }, `${t.name} (${nf(t.photos.length)})`))),
  );
  const p1 = h('input', { id: 'j1', value: 'Joueur 1', maxlength: 20, autocomplete: 'off' });
  const p2 = h('input', { id: 'j2', value: 'Joueur 2', maxlength: 20, autocomplete: 'off' });
  const duel = h('input', { type: 'checkbox', id: 'duel' });
  const p2row = h('p', { hidden: true }, h('label', { for: 'j2' }, 'Second joueur'), p2);
  duel.addEventListener('change', () => (p2row.hidden = !duel.checked));
  const rounds = h('input', { type: 'number', id: 'manches', min: 1, max: 20, value: DEFAULT_ROUNDS, inputmode: 'numeric' });

  screen(
    h('h2', {}, 'Nouvelle partie'),
    h('p', {}, h('label', { for: 'selection' }, 'Photos'), select),
    h('p', {}, h('label', { for: 'manches' }, 'Manches'), rounds),
    h('p', { class: 'case' }, duel, h('label', { for: 'duel' }, 'Duel sur ce téléphone')),
    h('p', {}, h('label', { for: 'j1' }, 'Joueur'), p1),
    p2row,
    h('div', { class: 'actions' },
      h('button', { class: 'principal', onclick: () => {
        const pool = selections[Number(select.value)].photos;
        const names = [p1.value.trim() || 'Joueur 1'];
        if (duel.checked) names.push(p2.value.trim() || 'Joueur 2');
        const n = Math.min(20, Math.max(1, Math.round(Number(rounds.value)) || DEFAULT_ROUNDS));
        play(newGame(pool, names, n), pool);
      } }, 'Commencer'),
      h('button', { onclick: () => {
        const pool = selections[Number(select.value)].photos;
        const n = Math.min(20, Math.max(1, Math.round(Number(rounds.value)) || DEFAULT_ROUNDS));
        sendToFriend(pool, n, p1.value.trim() || 'Un ami');
      } }, 'Envoyer à un ami'),
      h('button', { onclick: () => home() }, 'Retour'),
    ),
  );
}

// ---------- Partie ----------

interface PlayHooks {
  /** Appelé après chaque réponse validée (sauvegarde de la progression). */
  onGuess?: (game: Game) => void;
  /** Remplace l'écran de fin habituel. */
  onFinish?: (game: Game) => void;
}

function play(game: Game, pool: Photo[], hooks: PlayHooks = {}) {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const img = h('img', { class: 'photo', alt: '' });
  const mapEl = h('div', { class: 'carte' });
  const bar = h('div', { class: 'barre' });
  const photoFrame = h('div', { class: 'cadre-photo' }, img);
  const el = screen(photoFrame, mapEl, bar);
  el.classList.add('jeu');
  const map = new GameMap(mapEl);
  let pending: LatLng | undefined;

  const quit = () => {
    if (!confirm('Quitter la partie ? Les points seront perdus.')) return;
    map.destroy();
    home();
  };
  photoFrame.append(h('button', { class: 'quitter', onclick: quit, 'aria-label': 'Quitter la partie' }, '✕ Quitter'));

  const turn = () => {
    const photo = byId.get(currentPhoto(game).id)!;
    img.src = urlFor(photo);
    img.alt = `Photo ${game.round + 1} sur ${game.rounds.length}`;
    pending = undefined;
    map.clearReveal();
    map.setMarkers([]);
    map.frame(game.frame);
    const who = game.players.length > 1 ? `${game.players[game.player]} · ` : '';
    const validate = h('button', { class: 'principal', hidden: true, onclick: () => pending && reveal(pending) }, 'Valider');
    const hint = h('span', { class: 'consigne' }, 'Touche la carte pour placer ton repère');
    bar.replaceChildren(
      h('span', {}, `${who}Manche ${game.round + 1}/${game.rounds.length}`),
      hint,
      validate,
    );
    map.setTapHandler((p) => {
      pending = p;
      map.setMarkers([{ ...p, color: PLAYER_COLORS[game.player], label: game.players[game.player][0] }]);
      hint.hidden = true;
      validate.hidden = false;
    });
  };

  const reveal = (at: LatLng) => {
    submitGuess(game, at);
    hooks.onGuess?.(game);
    map.setTapHandler(undefined);
    const last = game.player === game.players.length - 1;
    if (!last) return handOver();
    const answer = currentPhoto(game);
    const gs = game.guesses[game.round];
    map.setMarkers([
      ...gs.map((g, i) => ({ ...g!, color: PLAYER_COLORS[i], label: game.players[i][0] })),
      { ...answer, color: ANSWER_COLOR },
    ]);
    map.reveal(answer, gs.map((g) => g!));
    const duel = game.players.length > 1;
    bar.replaceChildren(
      h('div', { class: duel ? 'resultats duel' : 'resultats', role: 'status' }, ...gs.map((g, i) => {
        const pin = h('span', { class: 'repere', 'aria-hidden': 'true' }, game.players[i][0]);
        pin.style.setProperty('--c', PLAYER_COLORS[i]);
        return h('div', { class: 'joueur' },
          duel ? pin : h('span'),
          h('span', { class: 'distance' }, `${duel ? game.players[i] + ' : ' : ''}${formatDistance(g!.distanceKm)}`),
          h('span', { class: 'points' }, `${nf(g!.score)} points`),
          h('meter', { min: 0, max: MAX_SCORE, value: g!.score, 'aria-hidden': 'true' }),
        );
      })),
      h('button', { class: 'principal', onclick: next }, game.round + 1 < game.rounds.length ? 'Suivant' : 'Résultats'),
    );
  };

  const next = () => (advance(game) ? turn() : finish());

  // Écran de passage plein écran : le joueur suivant ne voit pas le repère du précédent.
  const handOver = () => {
    advance(game);
    const cover = h('div', { class: 'passage' },
      h('p', {}, `Passe le téléphone à ${game.players[game.player]}`),
      h('button', { class: 'principal', onclick: () => { cover.remove(); turn(); } }, 'C’est moi, je joue'),
    );
    map.setMarkers([]);
    el.append(cover);
  };

  const finish = () => {
    map.destroy();
    if (hooks.onFinish) return hooks.onFinish(game);
    const t = totals(game);
    const max = MAX_SCORE * game.rounds.length;
    const best = Math.max(...t);
    screen(
      h('h2', {}, 'Fin de partie'),
      ...game.players.map((p, i) => h('p', { class: 'total' }, `${p} : ${nf(t[i])} / ${nf(max)}`,
        game.players.length > 1 && t[i] === best && t.filter((x) => x === best).length === 1 ? ' 🏆' : '')),
      game.players.length > 1 && t.every((x) => x === best) && h('p', {}, 'Égalité parfaite !'),
      h('div', { class: 'actions' },
        h('button', { class: 'principal', onclick: () => play(newGame(pool, game.players, game.rounds.length), pool) }, 'Rejouer'),
        h('button', { onclick: () => home() }, 'Accueil'),
      ),
    );
  };

  map.whenReady().then(turn);
}

// ---------- Entre amis, chacun son tour ----------

/** Partage par la feuille iOS (AirDrop, Messages…), ou téléchargement si elle n'existe pas. */
async function shareOut(data: { file?: File; text?: string }): Promise<'partagé' | 'copié' | 'téléchargé' | 'annulé'> {
  const payload: ShareData = data.file ? { files: [data.file] } : { text: data.text };
  if (navigator.canShare?.(payload)) {
    try {
      await navigator.share(payload);
      return 'partagé';
    } catch {
      return 'annulé';
    }
  }
  if (data.file) {
    const a = h('a', { href: URL.createObjectURL(data.file), download: data.file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return 'téléchargé';
  }
  await navigator.clipboard?.writeText(data.text ?? '').catch(() => undefined);
  return 'copié';
}

async function sendToFriend(pool: Photo[], rounds: number, from: string) {
  screen(h('h2', {}, 'Préparation…'));
  const draft = newGame(pool, ['ami'], Math.min(rounds, MAX_SHARED_PHOTOS));
  const byId = new Map(pool.map((p) => [p.id, p]));
  const picked = draft.rounds.map((r) => byId.get(r.id)!);
  const id = crypto.randomUUID();
  const code = newShareCode();
  const file = new File([await packGame({ id, createdAt: Date.now(), expiresAt: Date.now() + SHARE_TTL_MS, from, rounds: picked.map((p) => ({ image: p.blob, lat: p.lat, lng: p.lng })) }, code)], SHARE_FILE_NAME, { type: 'application/octet-stream' });
  await saveSentGame({ id, createdAt: Date.now(), answers: picked.map((p) => ({ lat: p.lat, lng: p.lng })) });
  const status = h('p', { role: 'status' });
  const grouped = code.replace(/(.{5})(?=.)/g, '$1 ');
  screen(
    h('h2', {}, 'Envoyer à un ami'),
    h('p', {}, `Ces ${plural(picked.length, 'photo', 'photos')} vont partir, sans date ni appareil. Ce qu’on y voit (visages, plaques, adresse) restera visible pour ton ami, qui peut aussi faire une capture d’écran. La partie s’effacera de son app à la fin, ou au bout de 7 jours.`),
    h('div', { class: 'vignettes' }, ...picked.map((p) => h('img', { src: urlFor(p), alt: '' }))),
    h('h3', {}, '1. Le fichier'),
    h('p', {}, 'Il est chiffré : sans le code, personne ne peut l’ouvrir.'),
    h('div', { class: 'actions' }, h('button', { class: 'principal', onclick: async () => (status.textContent = `Fichier ${await shareOut({ file })}.`) }, 'Envoyer le fichier')),
    h('h3', {}, '2. Le code, par un autre moyen'),
    h('p', { class: 'code' }, grouped),
    h('p', {}, 'Envoie-le dans un autre message, ou dis-le de vive voix. Ensuite, ton ami te renverra un code de résultat.'),
    h('div', { class: 'actions' },
      h('button', { onclick: async () => (status.textContent = `Code ${await shareOut({ text: code })}.`) }, 'Envoyer le code'),
      status,
      h('button', { onclick: () => home() }, 'Terminé'),
    ),
  );
}

function openReceived(message?: string) {
  const input = h('input', { type: 'file', hidden: true });
  const chosen = h('p', {}, 'Aucun fichier choisi.');
  input.addEventListener('change', () => (chosen.textContent = input.files?.[0] ? 'Fichier prêt.' : 'Aucun fichier choisi.'));
  const code = h('input', { id: 'code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCDE FGHIJ …' });
  const name = h('input', { id: 'prenom', maxlength: 20, autocomplete: 'off', value: 'Moi' });
  screen(
    h('h2', {}, 'Jouer une partie reçue'),
    message && h('p', { class: 'bandeau', role: 'alert' }, message),
    h('div', { class: 'actions' }, h('label', { class: 'bouton' }, 'Choisir le fichier reçu', input)),
    chosen,
    h('p', {}, h('label', { for: 'code' }, 'Code reçu (26 caractères)'), code),
    h('p', {}, h('label', { for: 'prenom' }, 'Ton prénom'), name),
    h('div', { class: 'actions' },
      h('button', { class: 'principal', onclick: async () => {
        const f = input.files?.[0];
        if (!f) return openReceived('Choisis d’abord le fichier reçu.');
        let shared;
        try { shared = await unpackGame(f, code.value); } catch (e) { return openReceived((e as Error).message); }
        const record: ReceivedGame = { id: shared.id, file: f, code: code.value, from: shared.from, player: name.value.trim() || 'Moi', expiresAt: shared.expiresAt, guesses: [] };
        await saveReceivedGame(record);
        screen(
          h('h2', {}, `Partie de ${shared.from} importée`),
          h('p', {}, `Tu peux maintenant supprimer le fichier reçu, il ne sert plus : dans Fichiers > Téléchargements s’il est arrivé par AirDrop, ou la pièce jointe dans la conversation Messages. Supprime aussi le message qui contenait le code.`),
          h('p', { class: 'badge' }, 'La partie s’effacera de l’app à la fin, ou au plus tard dans 7 jours (selon l’horloge de ton téléphone).'),
          h('div', { class: 'actions' }, h('button', { class: 'principal', onclick: () => playReceived(record) }, 'Commencer')),
        );
      } }, 'Jouer'),
      h('button', { onclick: () => home() }, 'Retour'),
    ),
  );
}

/** Lance ou reprend une partie reçue : déchiffrée en mémoire à chaque ouverture. */
async function playReceived(record: ReceivedGame) {
  let shared;
  try {
    shared = await unpackGame(record.file, record.code);
  } catch (e) {
    await deleteReceivedGame(record.id);
    return home((e as Error).message);
  }
  const pool: Photo[] = shared.rounds.map((r, i) => ({ id: `${shared.id}-${i}`, blob: r.image, lat: r.lat, lng: r.lng, takenAt: 0, addedAt: 0 }));
  const game = newGame(pool, [record.player], pool.length, true);
  // Reprise : on rejoue les réponses déjà données.
  for (const g of record.guesses.slice(0, pool.length)) {
    submitGuess(game, g);
    if (!advance(game)) break;
  }
  play(game, pool, {
    onGuess: (g) => {
      record.guesses = g.guesses.flatMap((r) => (r[0] ? [{ lat: r[0].lat, lng: r[0].lng }] : []));
      saveReceivedGame(record);
    },
    onFinish: async (g) => {
      await deleteReceivedGame(record.id);
      photoUrls.forEach((u, k) => k.startsWith(shared.id) && (URL.revokeObjectURL(u), photoUrls.delete(k)));
      const result = encodeResult({ gameId: shared.id, player: record.player, guesses: g.guesses.map((r) => ({ lat: r[0]!.lat, lng: r[0]!.lng, score: r[0]!.score })) });
      const status = h('p', { role: 'status' });
      screen(
        h('h2', {}, 'Fin de partie'),
        h('p', { class: 'total' }, `${record.player} : ${nf(totals(g)[0])} / ${nf(MAX_SCORE * g.rounds.length)}`),
        h('p', {}, `Renvoie ce code à ${shared.from} pour comparer vos scores :`),
        h('p', { class: 'code' }, result),
        h('p', { class: 'badge' }, 'La partie et ses photos ont été effacées de l’app.'),
        h('div', { class: 'actions' },
          h('button', { class: 'principal', onclick: async () => (status.textContent = `Code ${await shareOut({ text: result })}.`) }, 'Envoyer mon résultat'),
          status,
          h('button', { onclick: () => home() }, 'Accueil'),
        ),
      );
    },
  });
}

function readResult(message?: string) {
  const text = h('textarea', { id: 'resultat', rows: 4, spellcheck: 'false', placeholder: 'GWR1-…' });
  screen(
    h('h2', {}, 'Lire le résultat d’un ami'),
    message && h('p', { class: 'bandeau', role: 'alert' }, message),
    h('p', {}, h('label', { for: 'resultat' }, 'Colle ici le message reçu'), text),
    h('div', { class: 'actions' },
      h('button', { class: 'principal', onclick: async () => {
        let r;
        try { r = decodeResult(text.value); } catch (e) { return readResult((e as Error).message); }
        const sent = await getSentGame(r.gameId);
        if (!sent) return readResult('Cette partie n’a pas été envoyée depuis ce téléphone.');
        // Les scores sont recalculés ici à partir des points posés : on ne se fie pas à ceux du code.
        const scores = sent.answers.map((a, i) => (r.guesses[i] ? roundScore(distanceKm(r.guesses[i], a)) : 0));
        const total = scores.reduce((s, x) => s + x, 0);
        screen(
          h('h2', {}, `Résultat de ${r.player}`),
          h('p', { class: 'total' }, `${nf(total)} / ${nf(MAX_SCORE * sent.answers.length)}`),
          h('ol', { class: 'bilan' }, ...sent.answers.map((a, i) => {
            const g = r.guesses[i];
            return h('li', {}, g ? `${formatDistance(distanceKm(g, a))} · ${nf(scores[i])} points` : 'pas de réponse');
          })),
          h('div', { class: 'actions' }, h('button', { onclick: () => home() }, 'Accueil')),
        );
      } }, 'Voir le résultat'),
      h('button', { onclick: () => home() }, 'Retour'),
    ),
  );
}

// ---------- Réglages ----------

async function settings() {
  const photos = await allPhotos();
  screen(
    h('h2', {}, 'Réglages et confidentialité'),
    h('section', { class: 'texte' },
      h('h3', {}, 'Ce que GuessWhere garde'),
      h('ul', {},
        h('li', {}, 'Une copie réduite de chaque photo, ré-encodée : plus aucune métadonnée (date, appareil, position) dans l’image.'),
        h('li', {}, 'La position et la date de prise de vue, stockées à part, pour le jeu.'),
        h('li', {}, 'Tout reste dans l’app, sur ce téléphone. Rien n’est envoyé, la carte elle-même est embarquée.'),
      ),
    ),
    h('div', { class: 'actions' },
      h('button', { onclick: () => gpsTest() }, 'Tester la lecture GPS'),
      h('button', { class: 'danger', onclick: () => confirmWipe(photos.length, tripsOf(photos).length) }, 'Tout supprimer'),
      h('button', { onclick: () => home() }, 'Retour'),
    ),
  );
}

function confirmWipe(count: number, trips: number) {
  const wipe = async () => {
    try {
      await wipeEverything();
    } catch {
      home('La suppression n’a pas pu se terminer. Ferme les autres fenêtres de GuessWhere, puis réessaie.');
      return;
    }
    photoUrls.forEach((u) => URL.revokeObjectURL(u));
    photoUrls.clear();
    home(`Tout a été supprimé (${plural(count, 'photo', 'photos')}, ${plural(trips, 'voyage', 'voyages')}).`);
  };
  // Appui long de 2 s au doigt…
  const hold = h('button', { class: 'danger maintenir' }, 'Maintenir 2 secondes pour tout supprimer');
  let timer: number | undefined;
  const start = (e: PointerEvent) => {
    e.preventDefault();
    hold.classList.add('charge');
    timer = window.setTimeout(wipe, 2000);
  };
  const cancel = () => { clearTimeout(timer); hold.classList.remove('charge'); };
  hold.addEventListener('pointerdown', start);
  hold.addEventListener('pointerup', cancel);
  hold.addEventListener('pointerleave', cancel);
  hold.addEventListener('pointercancel', cancel);
  hold.addEventListener('contextmenu', (e) => e.preventDefault());
  // …ou deux confirmations successives, pour VoiceOver et le clavier, qui ne savent pas maintenir.
  const yes = h('button', { class: 'danger', hidden: true, onclick: wipe }, 'Oui, tout supprimer');
  const alt = h('button', { onclick: () => { alt.hidden = true; yes.hidden = false; yes.focus(); } }, 'Confirmer sans maintenir');
  screen(
    h('h2', {}, 'Tout supprimer ?'),
    h('p', {}, 'Seront effacés de ce téléphone :'),
    h('ul', { class: 'bilan' },
      h('li', {}, `${plural(count, 'photo', 'photos')} et leurs positions`),
      h('li', {}, plural(trips, 'voyage', 'voyages')),
      h('li', {}, 'les réglages et le cache hors ligne'),
    ),
    h('p', {}, 'C’est définitif.'),
    h('div', { class: 'actions' }, hold, alt, yes, h('button', { onclick: () => settings() }, 'Annuler')),
  );
}

/** Diagnostic : vérifie sur l'iPhone que Safari transmet bien la position des photos. Rien n'est enregistré. */
function gpsTest() {
  const out = h('ul', { class: 'bilan' });
  const input = h('input', { type: 'file', accept: '.heic,.heif,image/*', multiple: true, hidden: true });
  input.addEventListener('change', async () => {
    out.replaceChildren();
    for (const f of input.files ?? []) {
      const e = await readExif(f);
      out.append(h('li', {},
        `${f.type || 'type inconnu'}, ${nf(Math.round(f.size / 1024))} Ko : `,
        e.lat !== undefined ? `position trouvée (${e.lat.toFixed(4)}, ${e.lng!.toFixed(4)})` : 'aucune position',
        e.takenAt ? `, prise le ${new Date(e.takenAt).toLocaleString('fr-FR')}` : ', pas de date'));
    }
  });
  screen(
    h('h2', {}, 'Tester la lecture GPS'),
    h('p', {}, 'Choisis quelques photos (depuis Photos, puis depuis Fichiers). Rien n’est enregistré.'),
    h('div', { class: 'actions' }, h('label', { class: 'bouton principal' }, 'Choisir des photos', input)),
    out,
    h('div', { class: 'actions' }, h('button', { onclick: () => settings() }, 'Retour')),
  );
}

// Refus d'être affichée dans une page tierce (GitHub Pages ne permet pas
// l'en-tête frame-ancestors) : on ne peut pas piéger « Tout supprimer » dans une iframe.
if (window.top !== window.self) {
  document.body.replaceChildren(document.createTextNode('GuessWhere ne peut pas être affiché dans une autre page.'));
  throw new Error('GuessWhere refuse d’être intégré dans une iframe');
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

home();
