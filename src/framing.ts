import { distanceKm, type LatLng } from './geo';

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Photo médoïde : celle dont la somme des distances aux autres est la plus faible. */
export function medoid<T extends LatLng>(points: T[]): T {
  let best = points[0];
  let bestSum = Infinity;
  for (const p of points) {
    let sum = 0;
    for (const q of points) sum += distanceKm(p, q);
    if (sum < bestSum) [best, bestSum] = [p, sum];
  }
  return best;
}

/**
 * Cadrage de départ de la carte (décision C4/C13) : fixe pour toute la partie,
 * indépendant de la photo en cours (sinon il donne un indice). Centré sur la
 * photo médoïde, il englobe les 80 % de photos les plus proches, avec 30 % de marge.
 * Les longitudes sont rendues continues autour du médoïde (traversée de l'antiméridien).
 */
export function startFrame(points: LatLng[]): Bounds {
  const center = medoid(points);
  const kept = [...points]
    .sort((a, b) => distanceKm(center, a) - distanceKm(center, b))
    .slice(0, Math.max(1, Math.ceil(points.length * 0.8)));
  const lngs = kept.map((p) => {
    let lng = p.lng;
    while (lng - center.lng > 180) lng -= 360;
    while (center.lng - lng > 180) lng += 360;
    return lng;
  });
  const lats = kept.map((p) => p.lat);
  let [west, east, south, north] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
  const mLng = Math.max((east - west) * 0.3, 0.02);
  const mLat = Math.max((north - south) * 0.3, 0.02);
  west -= mLng; east += mLng;
  south = Math.max(-85, south - mLat); north = Math.min(85, north + mLat);
  if (east - west > 360) [west, east] = [-180, 180];
  return { west, south, east, north };
}
