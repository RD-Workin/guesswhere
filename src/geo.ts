export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Distance orthodromique (haversine) en kilomètres. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Étendue d'un ensemble de points : la plus grande distance entre deux points.
 * O(n²), suffisant pour quelques centaines de photos par partie.
 */
export function spreadKm(points: LatLng[]): number {
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      max = Math.max(max, distanceKm(points[i], points[j]));
    }
  }
  return max;
}

/** Distance en français. On arrondit avant de choisir l'unité (pas de « 1000 m » ni de « 10,0 km »). */
export function formatDistance(km: number): string {
  const m = Math.round(km * 1000);
  if (m < 1000) return `${m} m`;
  const tenths = Math.round(km * 10) / 10;
  if (tenths < 10) return `${tenths.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km).toLocaleString('fr-FR')} km`;
}
