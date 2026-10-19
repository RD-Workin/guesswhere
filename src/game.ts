import { distanceKm, type LatLng } from './geo';
import { roundScore } from './score';

export interface GamePhoto extends LatLng {
  id: string;
}

export interface Guess extends LatLng {
  distanceKm: number;
  score: number;
}

export interface Game {
  players: string[];
  rounds: GamePhoto[];
  /** guesses[manche][joueur] */
  guesses: (Guess | undefined)[][];
  round: number;
  player: number;
}

export const DEFAULT_ROUNDS = 5;

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Prépare une partie.
 * `ordered` garde l'ordre donné (partie reçue d'un ami : mêmes photos, même ordre).
 */
export function newGame(pool: GamePhoto[], players: string[], rounds = DEFAULT_ROUNDS, ordered = false): Game {
  if (!pool.length) throw new Error('Aucune photo à jouer');
  if (!players.length) throw new Error('Aucun joueur');
  const picked = (ordered ? pool : shuffle(pool)).slice(0, Math.max(1, rounds));
  return {
    players,
    rounds: picked,
    guesses: picked.map(() => players.map(() => undefined)),
    round: 0,
    player: 0,
  };
}

export function currentPhoto(game: Game): GamePhoto {
  return game.rounds[game.round];
}

/** Enregistre la réponse du joueur courant et renvoie le résultat de la manche pour lui. */
export function submitGuess(game: Game, at: LatLng): Guess {
  const answer = currentPhoto(game);
  const d = distanceKm(at, answer);
  const guess: Guess = { lat: at.lat, lng: at.lng, distanceKm: d, score: roundScore(d) };
  game.guesses[game.round][game.player] = guess;
  return guess;
}

/** Tous les joueurs ont-ils répondu pour la manche en cours ? */
export function roundComplete(game: Game): boolean {
  return game.guesses[game.round].every(Boolean);
}

/** Passe au joueur suivant, ou à la manche suivante. Renvoie false à la fin de la partie. */
export function advance(game: Game): boolean {
  if (!roundComplete(game)) {
    game.player++;
    return true;
  }
  if (game.round + 1 >= game.rounds.length) return false;
  game.round++;
  game.player = 0;
  return true;
}

export function totals(game: Game): number[] {
  return game.players.map((_, p) => game.guesses.reduce((sum, r) => sum + (r[p]?.score ?? 0), 0));
}
