import { spreadKm, type LatLng } from './geo';

export const MAX_SCORE = 5000;
/** Échelle minimale : une partie dans un seul quartier reste jouable. */
export const MIN_SCALE_KM = 2;
/** Échelle maximale : la moitié de la circonférence terrestre. */
export const MAX_SCALE_KM = 20000;

/**
 * Échelle d'une partie, calculée à partir de l'étendue de ses photos.
 * C'est elle qui rend le score pertinent à l'échelle d'une ville comme
 * entre deux continents : se tromper de 1 km compte beaucoup dans Paris
 * et presque rien dans un tour du monde.
 */
export function gameScaleKm(points: LatLng[]): number {
  return Math.min(MAX_SCALE_KM, Math.max(MIN_SCALE_KM, spreadKm(points)));
}

/**
 * Score d'une manche, décroissance exponentielle façon GeoGuessr :
 * 5000 points à distance nulle, ~1840 à 10 % de l'échelle, ~0 au-delà de 60 %.
 * Une erreur inférieure à 0,5 % de l'échelle donne le score parfait.
 */
export function roundScore(distanceKm: number, scaleKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  if (distanceKm <= scaleKm * 0.005) return MAX_SCORE;
  return Math.round(MAX_SCORE * Math.exp((-10 * distanceKm) / scaleKm));
}
