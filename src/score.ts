export const MAX_SCORE = 5000;
/** En dessous de 100 m (précision du GPS), la réponse est parfaite. */
export const PERFECT_KM = 0.1;
/** Au-delà de 20 000 km (antipodes), la réponse vaut 0. */
export const ZERO_KM = 20000;

/**
 * Score d'une manche, logarithmique (décision C4 / bug B1) :
 * chaque facteur 10 sur la distance coûte environ 943 points, quelle que soit
 * l'échelle. Se tromper de 1 km au lieu de 100 m pèse autant que 1 000 km au
 * lieu de 100 km : le jeu marche dans une ville comme entre deux continents,
 * sans dépendre des autres photos de la partie.
 *
 * 100 m = 5000 · 1 km = 4057 · 10 km = 3114 · 344 km = 1664 · 5 837 km = 504 · antipodes = 0
 */
export function roundScore(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  const ratio = Math.log10(Math.max(distanceKm, PERFECT_KM) / PERFECT_KM) / Math.log10(ZERO_KM / PERFECT_KM);
  return Math.round(MAX_SCORE * Math.min(1, Math.max(0, 1 - ratio)));
}
