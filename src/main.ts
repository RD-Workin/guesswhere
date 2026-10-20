import './style.css';
import { addPhoto, allPhotos, deletePhotos, deleteReceivedGame, loadPhotos, migratePhotos, purgeExpiredReceived, receivedGames, requestPersistence, saveReceivedGame, wipeEverything, wipePhotos, type ReceivedGame } from './db';
import { advance, currentPhoto, newGame, submitGuess, totals, DEFAULT_ROUNDS, type Game } from './game';
import { formatDistance, type LatLng } from './geo';
import { GameMap, resetSatellite } from './map';
import { importFile, readExif, type Photo } from './photos';
import { MAX_SCORE } from './score';
import { newShareCode, packGame, unpackGame, MAX_SHARED_PHOTOS, SHARE_FILE_NAME, SHARE_TTL_MS } from './share';
import * as satellite from './satellite';
import { groupIntoTrips } from './trips';
import { checkTest, cleanTest, startTest, testPending } from './cryptotest';
import { acceptUpdate, CHANGES_URL, installedVersion, onUpdateWaiting, registerServiceWorker, updateWaiting } from './update';
import { h, nf, plural, screen } from './ui';
import { globe, heroArt, logo } from './decor';
import { applyTheme, getTheme, setTheme, type Theme } from './theme';
import { confetti, countUp, stars, verdict } from './fun';

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

/** Pictogramme décoratif devant un libellé (ignoré par VoiceOver). */
const ico = (e: string) => h('span', { class: 'ico', 'aria-hidden': 'true' }, e);
const txt = (t: string) => h('span', {}, t);

/** Carte de mode de jeu : pictogramme, titre et sous-titre. */
const mode = (icon: string, title: string, sub: string, onclick: () => void, tone = '') =>
  h('button', { class: `mode ${tone}`, onclick }, ico(icon), h('span', { class: 'mode-texte' }, h('strong', {}, title), h('small', {}, sub)));

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
  const { photos, lost } = await loadPhotos();
  const pending = await receivedGames();
  const countries = new Set(photos.map((p) => p.countryName).filter(Boolean)).size;
  const trips = tripsOf(photos).length;
  const el = screen(
    h('header', { class: 'titre heros' },
      heroArt(),
      h('div', { class: 'marque' }, logo(), h('h1', { 'aria-label': 'GuessWhere' }, h('span', { class: 'guess' }, 'Guess'), h('span', { class: 'where' }, 'Where'))),
      h('p', { class: 'slogan' }, 'Le monde est ton terrain de jeu.', h('br'), 'Devine où ont été prises tes photos\u00a0!'),
      h('p', { class: 'badge' }, 'Sur ton iPhone uniquement'),
    ),
    message && h('p', { class: 'info', role: 'status' }, message),
    updateWaiting() && h('section', { class: 'bandeau' },
      h('p', {}, h('strong', {}, 'Nouvelle version disponible.'), ' Elle ne s’installe pas sans ton accord.'),
      h('p', {}, h('a', { href: CHANGES_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Voir ce qui change')),
      h('button', { class: 'principal', onclick: () => acceptUpdate() }, 'Installer la nouvelle version'),
    ),
    lost.length > 0 && h('section', { class: 'bandeau', role: 'alert' },
      h('p', {}, h('strong', {}, `${plural(lost.length, 'photo illisible', 'photos illisibles')}.`), ' Leur clé de chiffrement a disparu de cet iPhone, ce qui peut arriver après une restauration ou une mise à jour d’iOS. Tes autres photos et tes parties reçues ne sont pas touchées.'),
      h('button', { class: 'principal', onclick: async () => {
        await deletePhotos(lost);
        home('Photos illisibles retirées. Choisis-les de nouveau avec « Importer des photos ».');
      } }, 'Réimporter'),
    ),
    !canImport() && h('section', { class: 'bandeau' },
      h('p', {}, h('strong', {}, 'Installe d’abord GuessWhere sur ton écran d’accueil.')),
      h('ol', {},
        h('li', {}, 'Touche le bouton Partager de Safari (le carré avec une flèche).'),
        h('li', {}, 'Choisis « Sur l’écran d’accueil », puis « Ajouter ».'),
        h('li', {}, 'Ouvre GuessWhere depuis sa nouvelle icône et importe tes photos.'),
      ),
      h('p', {}, 'Tes photos sont gardées seulement sur cet iPhone, dans l’app installée. Dans un simple onglet, Safari pourrait les effacer.'),
    ),
    h('div', { class: 'horizon' }, globe()),
    photos.length > 0 && h('div', { class: 'actions jouer-zone' },
      h('button', { class: 'principal jouer', onclick: () => setup(photos) }, ico('▶︎'), txt('Jouer'))),
    photos.length > 0
      ? h('ul', { class: 'compteurs' },
        h('li', {}, `📸 ${plural(photos.length, 'photo', 'photos')} prête${photos.length > 1 ? 's' : ''} à jouer`),
        countries > 0 && h('li', {}, `🌍 ${plural(countries, 'pays', 'pays')}`),
        trips > 0 && h('li', {}, `✈️ ${plural(trips, 'voyage', 'voyages')}`))
      : h('p', { class: 'vide' }, 'Aucune photo pour l’instant. Importe des photos de voyage : seules leur position et leur date sont lues, ici même.'),
    h('section', { class: 'modes' },
      h('h2', {}, 'Choisis ta partie'),
      ...pending.map((g) => mode('⏯️', `Reprendre la partie de ${g.from}`, 'Ta partie reçue t’attend', () => playReceived(g), 'orange')),
      photos.length > 0 && mode('⚔️', 'Duel', 'À deux sur ce téléphone', () => setup(photos, true), 'orange'),
      mode('📩', 'Jouer une partie reçue', 'Avec le fichier et le code d’un ami', () => openReceived()),
      photos.length > 0 && mode('🗺️', 'Mes voyages', 'Tes photos rangées par voyage', () => library(photos)),
      canImport() && importButton('Importer des photos', false, '📷', 'Seules la position et la date sont lues'),
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'discret', onclick: () => settings() }, ico('⚙️'), txt('Réglages et confidentialité')),
    ),
  );
  el.classList.add('accueil');
}

/**
 * Sélecteur de photos. Accepter explicitement le HEIC fait livrer par Safari
 * l'original (plus léger, GPS conservé) au lieu d'un JPEG converti (test iOS 18.7).
 */
function importButton(label = 'Importer des photos', primary = false, icon?: string, sub?: string): HTMLElement {
  const input = h('input', { type: 'file', accept: '.heic,.heif,image/*', multiple: true, hidden: true });
  input.addEventListener('change', () => input.files?.length && runImport([...input.files]));
  if (icon) return h('label', { class: 'bouton mode' }, ico(icon), h('span', { class: 'mode-texte' }, h('strong', {}, label), sub && h('small', {}, sub)), input);
  return h('label', { class: primary ? 'bouton principal' : 'bouton' }, label, input);
}

async function runImport(files: File[]) {
  const progress = h('progress', { max: files.length, value: 0 });
  const label = h('p', {}, `Lecture de ${plural(files.length, 'photo', 'photos')}…`);
  screen(h('div', { class: 'anime-import', 'aria-hidden': 'true' }, '📸'), h('h2', {}, 'Import'), label, progress);
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
    ok > 0 && h('div', { class: 'anime-import', 'aria-hidden': 'true' }, '🎉'),
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

function setup(photos: Photo[], duelFirst = false) {
  const selections: Trip[] = [{ name: 'Toutes les photos', photos }, ...tripsOf(photos), ...countriesOf(photos)];
  const select = h('select', { id: 'selection' },
    h('option', { value: '0' }, `Toutes les photos (${nf(photos.length)})`),
    h('optgroup', { label: 'Par voyage' }, ...tripsOf(photos).map((t, i) => h('option', { value: String(1 + i) }, `${t.name} (${nf(t.photos.length)})`))),
    h('optgroup', { label: 'Par pays' }, ...countriesOf(photos).map((t, i) => h('option', { value: String(1 + tripsOf(photos).length + i) }, `${t.name} (${nf(t.photos.length)})`))),
  );
  const p1 = h('input', { id: 'j1', value: 'Joueur 1', maxlength: 20, autocomplete: 'off' });
  const p2 = h('input', { id: 'j2', value: 'Joueur 2', maxlength: 20, autocomplete: 'off' });
  const duel = h('input', { type: 'checkbox', id: 'duel', checked: duelFirst });
  const p2row = h('p', { hidden: !duelFirst }, h('label', { for: 'j2' }, 'Second joueur'), p2);
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
        const start = () => play(newGame(pool, names, n), pool);
        if (names.length > 1) guidedAccessTip(start); else start();
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

/** Conseil montré une seule fois avant le premier duel : prêter son téléphone sans donner accès au reste. */
function guidedAccessTip(start: () => void) {
  const KEY = 'conseil-acces-guide';
  let seen = false;
  try { seen = localStorage.getItem(KEY) === '1'; localStorage.setItem(KEY, '1'); } catch { /* stockage indisponible */ }
  if (seen) return start();
  screen(
    h('h2', {}, 'Avant de prêter ton téléphone'),
    h('p', {}, 'Pour que l’autre joueur reste dans GuessWhere sans pouvoir ouvrir tes photos ou tes messages, active l’Accès guidé : triple clic sur le bouton latéral, puis « Démarrer ». Même triple clic et ton code pour en sortir.'),
    h('p', {}, 'Si l’option n’apparaît pas : Réglages > Accessibilité > Accès guidé.'),
    h('div', { class: 'actions' }, h('button', { class: 'principal', onclick: start }, 'Compris, on joue')),
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
  const dots = game.rounds.map(() => h('i'));
  photoFrame.append(h('div', { class: 'pastilles', 'aria-hidden': 'true' }, ...dots));
  const refreshDots = () => dots.forEach((d, i) => (d.className = i < game.round ? 'fait' : i === game.round ? 'encours' : ''));

  const turn = () => {
    const photo = byId.get(currentPhoto(game).id)!;
    img.src = urlFor(photo);
    img.alt = `Photo ${game.round + 1} sur ${game.rounds.length}`;
    pending = undefined;
    map.clearReveal();
    map.setMarkers([]);
    map.resetView();
    refreshDots();
    bar.className = 'barre';
    const who = game.players.length > 1 ? `${game.players[game.player]} · ` : '';
    const validate = h('button', { class: 'principal', hidden: true, onclick: () => pending && reveal(pending) }, 'Valider');
    const hint = h('span', { class: 'consigne' }, 'Touche la carte pour placer ton repère');
    bar.replaceChildren(
      h('span', { class: 'manche' }, `${who}Manche ${game.round + 1}/${game.rounds.length}`),
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
      { ...answer, color: ANSWER_COLOR, target: true },
    ]);
    map.reveal(answer, gs.map((g) => g!));
    const duel = game.players.length > 1;
    const scores = gs.map((g) => g!.score);
    const top = Math.max(...scores);
    const v = verdict(top);
    const winner = scores.indexOf(top);
    const tie = scores.filter((x) => x === top).length > 1;
    const line = !duel ? h('p', { class: 'verdict' }, ico(v.emoji), txt(v.text))
      : tie ? h('p', { class: 'verdict' }, ico('🤝'), txt('Égalité sur cette manche'))
      : h('p', { class: 'verdict' }, ico('🏅'), txt(`${game.players[winner]} gagne la manche\u00a0!`));
    bar.className = `barre revele ton-${v.tone}`;
    bar.replaceChildren(
      line,
      h('div', { class: 'ligne-resultat' },
        h('div', { class: duel ? 'resultats duel' : 'resultats', role: 'status' }, ...gs.map((g, i) => {
          const pin = h('span', { class: 'repere', 'aria-hidden': 'true' }, game.players[i][0]);
          pin.style.setProperty('--c', PLAYER_COLORS[i]);
          // Le nombre défile à l'écran ; VoiceOver lit directement la valeur finale.
          const shown = h('span', { 'aria-hidden': 'true' });
          countUp(shown, g!.score, nf, 800);
          const gauge = h('span', { class: 'jauge', 'aria-hidden': 'true' }, h('i'));
          (gauge.firstChild as HTMLElement).style.setProperty('--p', String(g!.score / MAX_SCORE));
          return h('div', { class: 'joueur' },
            duel && pin,
            h('span', { class: 'distance' }, `${duel ? game.players[i] + ' : ' : ''}${formatDistance(g!.distanceKm)}`),
            h('span', { class: 'points' }, shown, h('span', { class: 'vh' }, nf(g!.score)), ' points'),
            gauge,
          );
        })),
        h('button', { class: 'principal', onclick: next }, game.round + 1 < game.rounds.length ? 'Suivant' : 'Résultats'),
      ),
    );
    if (top >= 4800) confetti(28);
  };

  const next = () => (advance(game) ? turn() : finish());

  // Écran de passage plein écran : le joueur suivant ne voit pas le repère du précédent.
  const handOver = () => {
    advance(game);
    const name = game.players[game.player];
    const avatar = h('div', { class: 'avatar', 'aria-hidden': 'true' }, name[0]);
    avatar.style.setProperty('--c', PLAYER_COLORS[game.player]);
    const cover = h('div', { class: 'passage' },
      avatar,
      ico('📱'),
      h('p', {}, `Passe le téléphone à ${name}`),
      h('small', {}, 'Pas de triche : l’autre ne regarde pas\u00a0!'),
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
    const duel = game.players.length > 1;
    const alone = t.filter((x) => x === best).length === 1;
    const n = stars(best, max);
    const big = h('p', { class: 'grand-score', 'aria-hidden': 'true' });
    countUp(big, best, nf, 1200);
    screen(
      h('div', { class: 'fin' },
        h('div', { class: 'trophee', 'aria-hidden': 'true' }, duel ? (alone ? '🏆' : '🤝') : ['🧭', '🎉', '🥈', '🏆'][n]),
        h('h2', {}, 'Fin de partie'),
        !duel && starRow(n),
        !duel && big,
        ...game.players.map((p, i) => h('p', { class: 'total' }, `${p} : ${nf(t[i])} / ${nf(max)}`,
          duel && t[i] === best && alone ? ' 🏆' : '')),
        duel && t.every((x) => x === best) && h('p', {}, 'Égalité parfaite !'),
        recap(game),
      ),
      h('div', { class: 'actions' },
        h('button', { class: 'principal', onclick: () => play(newGame(pool, game.players, game.rounds.length), pool) }, 'Rejouer'),
        h('button', { onclick: () => home() }, 'Accueil'),
      ),
    );
    if (n >= 2 || (duel && alone)) confetti();
  };

  map.whenReady().then(turn);
}

/** Étoiles de fin de partie (sur 3), lues « 2 étoiles sur 3 » par VoiceOver. */
function starRow(n: number): HTMLElement {
  return h('p', { class: 'etoiles', role: 'img', 'aria-label': `${n} étoile${n > 1 ? 's' : ''} sur 3` },
    ...[0, 1, 2].map((i) => h('span', { class: i < n ? 'on' : '' }, '★')));
}

/** Points de chaque manche, en petites cartes. */
function recap(game: Game): HTMLElement {
  return h('ol', { class: 'recap' }, ...game.guesses.map((gs, r) => h('li', {},
    h('span', {}, `Manche ${r + 1}`),
    h('b', {}, gs.map((g) => (g ? `${verdict(g.score).emoji} ${nf(g.score)}` : '–')).join('  ·  ')),
  )));
}

// ---------- Entre amis : mêmes photos, chacun sur son téléphone ----------

/** Partage par la feuille iOS (AirDrop, Messages…), ou téléchargement si elle n'existe pas. */
async function shareOut(data: { file?: File; text?: string }): Promise<'partagé' | 'à recopier' | 'téléchargé' | 'annulé'> {
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
  // Pas de copie dans le presse-papiers : avec Continuité, iOS le recopierait sur le Mac voisin.
  return 'à recopier';
}

async function sendToFriend(pool: Photo[], rounds: number, from: string) {
  screen(h('h2', {}, 'Préparation…'));
  const draft = newGame(pool, ['ami'], Math.min(rounds, MAX_SHARED_PHOTOS));
  const byId = new Map(pool.map((p) => [p.id, p]));
  const picked = draft.rounds.map((r) => byId.get(r.id)!);
  const id = crypto.randomUUID();
  const code = newShareCode();
  const file = new File([await packGame({ id, createdAt: Date.now(), expiresAt: Date.now() + SHARE_TTL_MS, from, rounds: picked.map((p) => ({ image: p.blob, lat: p.lat, lng: p.lng })) }, code)], SHARE_FILE_NAME, { type: 'application/octet-stream' });
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
    h('p', {}, 'Envoie-le dans un autre message, ou dis-le de vive voix. Ton ami jouera les mêmes photos sur son téléphone et verra son score à la fin.'),
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
        const record: ReceivedGame = { id: shared.id, file: f, code: code.value, from: shared.from, player: name.value.trim() || 'Moi', expiresAt: Math.min(shared.expiresAt, Date.now() + SHARE_TTL_MS), guesses: [] };
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
      const total = totals(g)[0];
      const max = MAX_SCORE * g.rounds.length;
      const n = stars(total, max);
      const big = h('p', { class: 'grand-score', 'aria-hidden': 'true' });
      countUp(big, total, nf, 1200);
      screen(
        h('div', { class: 'fin' },
          h('div', { class: 'trophee', 'aria-hidden': 'true' }, ['🧭', '🎉', '🥈', '🏆'][n]),
          h('h2', {}, 'Fin de partie'),
          starRow(n),
          big,
          h('p', { class: 'total' }, `${record.player} : ${nf(total)} / ${nf(max)}`),
          h('p', {}, `Partie envoyée par ${shared.from}.`),
          recap(g),
        ),
        h('p', { class: 'badge' }, 'La partie et ses photos ont été effacées de l’app.'),
        h('div', { class: 'actions' }, h('button', { class: 'principal', onclick: () => home() }, 'Accueil')),
      );
      if (n >= 2) confetti();
    },
  });
}

// ---------- Réglages ----------

async function settings() {
  const photos = await allPhotos();
  // Repère de la version installée : le même code est affiché dans le résumé de chaque publication sur GitHub (onglet Actions).
  const version = h('p', { class: 'badge' }, 'Repère de version : …');
  installedVersion().then((v) => (version.textContent = `Repère de version : ${v}`));
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
    themeSection(),
    satelliteSection(),
    version,
    h('div', { class: 'actions' },
      h('button', { onclick: () => gpsTest() }, 'Tester la lecture GPS'),
      h('button', { onclick: () => cryptoTest() }, 'Tester le chiffrement'),
      h('button', { class: 'danger', onclick: () => confirmWipe(photos.length, tripsOf(photos).length, false) }, 'Supprimer les photos'),
      h('button', { class: 'danger', onclick: () => confirmWipe(photos.length, tripsOf(photos).length, true) }, 'Tout supprimer'),
      h('button', { onclick: () => home() }, 'Retour'),
    ),
  );
}

/** Apparence : automatique (réglage de l'iPhone), clair ou sombre. */
function themeSection(): HTMLElement {
  const choices: [Theme, string][] = [['auto', 'Auto'], ['clair', '☀️ Clair'], ['sombre', '🌙 Sombre']];
  const group = h('div', { class: 'segments', role: 'group', 'aria-label': 'Apparence' });
  const draw = () => group.replaceChildren(...choices.map(([t, label]) =>
    h('button', { 'aria-pressed': String(getTheme() === t), onclick: () => { setTheme(t); draw(); } }, label)));
  draw();
  return h('section', { class: 'texte' }, h('h3', {}, 'Apparence'), group,
    h('p', { class: 'badge-simple' }, 'Auto suit le mode clair ou sombre de l’iPhone.'));
}

const mo = (octets: number) => `${nf(Math.round(octets / 1e6))} Mo`;

/**
 * Téléchargement de la vue satellite : un seul fichier, le même pour tous,
 * donc rien ne trahit les lieux des photos. Proposé, jamais imposé, à cause de sa taille.
 */
function satelliteSection(): HTMLElement {
  const status = h('p', {}, 'Recherche de la vue satellite…');
  const buttons = h('div', { class: 'actions' });
  const section = h('section', { class: 'texte' },
    h('h3', {}, 'Vue satellite'),
    h('p', {}, 'Images de la Terre vue de l’espace (NASA), nettes à l’échelle des pays et des îles, floues à l’échelle d’une ville. Un seul fichier, le même pour tout le monde : il ne révèle aucun lieu, et il marche ensuite en mode avion.'),
    status, buttons,
  );

  const refresh = async () => {
    const [info, installed] = await Promise.all([satellite.publishedInfo(), satellite.installedVersion()]);
    buttons.replaceChildren();
    const get = (label: string) => h('button', {
      onclick: async () => {
        buttons.replaceChildren();
        status.textContent = 'Téléchargement… 0 %';
        try {
          await satellite.download(info!, (f) => { status.textContent = `Téléchargement… ${Math.floor(f * 100)} %`; });
          await requestPersistence();
        } catch {
          status.textContent = 'Le téléchargement n’a pas abouti. Vérifie la connexion, puis réessaie.';
        }
        resetSatellite();
        refresh();
      },
    }, label);
    if (installed) {
      status.textContent = 'Vue satellite installée sur ce téléphone.';
      if (info && info.version !== installed) buttons.append(get(`Mettre à jour (${mo(info.octets)})`));
      buttons.append(h('button', {
        onclick: async () => { await satellite.remove(); resetSatellite(); refresh(); },
      }, 'Retirer la vue satellite'));
    } else if (info) {
      status.textContent = `${mo(info.octets)} à télécharger, de préférence en Wi-Fi.`;
      buttons.append(get('Télécharger la vue satellite'));
    } else {
      status.textContent = 'Pas disponible pour l’instant (connexion nécessaire).';
    }
  };
  refresh();
  return section;
}

/** Suppression définitive, des photos seules ou de tout (vue satellite et cache hors ligne compris). */
function confirmWipe(count: number, trips: number, all: boolean) {
  const what = all ? 'tout supprimer' : 'supprimer les photos';
  const wipe = async () => {
    try {
      await (all ? wipeEverything() : wipePhotos());
    } catch {
      home('La suppression n’a pas pu se terminer. Ferme les autres fenêtres de GuessWhere, puis réessaie.');
      return;
    }
    photoUrls.forEach((u) => URL.revokeObjectURL(u));
    photoUrls.clear();
    if (all) { resetSatellite(); applyTheme(); }
    const bilan = `${plural(count, 'photo', 'photos')}, ${plural(trips, 'voyage', 'voyages')}`;
    home(all ? `Tout a été supprimé (${bilan}).` : `Photos supprimées (${bilan}). La vue satellite est gardée.`);
  };
  // Appui long de 2 s au doigt…
  const hold = h('button', { class: 'danger maintenir' }, `Maintenir 2 secondes pour ${what}`);
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
  const yes = h('button', { class: 'danger', hidden: true, onclick: wipe }, `Oui, ${what}`);
  const alt = h('button', { onclick: () => { alt.hidden = true; yes.hidden = false; yes.focus(); } }, 'Confirmer sans maintenir');
  screen(
    h('h2', {}, all ? 'Tout supprimer ?' : 'Supprimer les photos ?'),
    h('p', {}, 'Seront effacés de ce téléphone :'),
    h('ul', { class: 'bilan' },
      h('li', {}, `${plural(count, 'photo', 'photos')} et leurs positions`),
      h('li', {}, plural(trips, 'voyage', 'voyages')),
      h('li', {}, 'les parties reçues d’amis'),
      all
        ? h('li', {}, 'la vue satellite, les réglages et le cache hors ligne')
        : null,
    ),
    all ? null : h('p', {}, 'La vue satellite et l’app hors ligne restent installées : elles ne contiennent aucune donnée personnelle.'),
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

/** Test du chiffrement local sur ce téléphone, avec des données fictives (securite-rgpd.md §19). */
async function cryptoTest() {
  const back = h('button', { onclick: () => settings() }, 'Retour');
  const clean = h('button', { onclick: async () => { await cleanTest(); cryptoTest(); } }, 'Nettoyer le test');
  const intro = h('p', {}, 'Ce test utilise des images fictives, pas tes photos. Il vérifie que ton iPhone garde une clé de chiffrement secrète après la fermeture de l’app.');
  if (!(await testPending())) {
    const status = h('p', { role: 'status' });
    const go = h('button', { class: 'principal', onclick: async () => {
      go.disabled = true;
      status.textContent = 'Chiffrement en cours…';
      try {
        await startTest();
        status.textContent = 'Étape 1 réussie. Ferme l’app depuis le sélecteur d’apps (glisse-la vers le haut), puis rouvre-la et reviens ici.';
      } catch (e) {
        status.textContent = `Échec de l’étape 1 : ${(e as Error).message}`;
      }
    } }, 'Lancer le test');
    return screen(h('h2', {}, 'Tester le chiffrement'), intro, h('div', { class: 'actions' }, go), status, h('div', { class: 'actions' }, back));
  }
  let lines: string[];
  try {
    const r = await checkTest();
    const ok = r.decrypted && !r.extractable && r.ms < 200;
    lines = [
      ok ? 'Test réussi : le chiffrement peut être activé sur ce téléphone.' : 'Test échoué : envoie une capture de cet écran.',
      `Images déchiffrées après réouverture : ${r.decrypted ? 'oui' : 'non'}`,
      `Clé impossible à extraire : ${r.extractable ? 'non' : 'oui'}`,
      `Temps pour 15 images : ${nf(r.ms)} ms (objectif : moins de 200 ms)`,
    ];
  } catch (e) {
    lines = ['Test échoué : envoie une capture de cet écran.', (e as Error).message];
  }
  screen(
    h('h2', {}, 'Tester le chiffrement'),
    h('section', { class: 'bandeau', role: 'status' }, ...lines.map((l) => h('p', {}, l))),
    h('div', { class: 'actions' }, clean, back),
  );
}

// Refus d'être affichée dans une page tierce (GitHub Pages ne permet pas
// l'en-tête frame-ancestors) : on ne peut pas piéger « Tout supprimer » dans une iframe.
if (window.top !== window.self) {
  document.body.replaceChildren(document.createTextNode('GuessWhere ne peut pas être affiché dans une autre page.'));
  throw new Error('GuessWhere refuse d’être intégré dans une iframe');
}

// Écran neutre quand l'app passe en arrière-plan : la vignette du sélecteur
// d'apps d'iOS ne montre ni photo ni carte.
const masque = h('div', { class: 'masque', 'aria-hidden': 'true' }, h('img', { src: './icone-512.png', alt: '' }));
const masquer = (on: boolean) => (on ? document.body.append(masque) : masque.remove());
document.addEventListener('visibilitychange', () => masquer(document.visibilityState === 'hidden'));
window.addEventListener('pagehide', () => masquer(true));
window.addEventListener('pageshow', () => masquer(document.visibilityState === 'hidden'));

if (import.meta.env.PROD) {
  registerServiceWorker().catch(() => undefined);
  // Le bandeau de mise à jour n'apparaît qu'à l'accueil, jamais en pleine partie.
  onUpdateWaiting(() => document.querySelector('.titre') && home());
}

applyTheme();

// Photos importées avant le chiffrement : chiffrées une à une avant l'accueil.
migratePhotos().catch(() => undefined).then(() => home());
