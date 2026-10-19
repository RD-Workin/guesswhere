import './style.css';
import { addPhoto, allPhotos, requestPersistence, wipeEverything } from './db';
import { advance, currentPhoto, newGame, submitGuess, totals, DEFAULT_ROUNDS, type Game } from './game';
import { formatDistance, type LatLng } from './geo';
import { GameMap } from './map';
import { importFile, readExif, type Photo } from './photos';
import { MAX_SCORE } from './score';
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
  return groupIntoTrips(photos).map((ps) => {
    const counts = new Map<string, number>();
    for (const p of ps) if (p.countryName) counts.set(p.countryName, (counts.get(p.countryName) ?? 0) + 1);
    const country = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Voyage';
    return { name: `${country} · ${monthFmt.format(ps[0].takenAt)}`, photos: ps };
  }).reverse();
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
  const photos = await allPhotos();
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
      h('button', { onclick: () => home() }, 'Retour'),
    ),
  );
}

// ---------- Partie ----------

function play(game: Game, pool: Photo[]) {
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
    await wipeEverything();
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
