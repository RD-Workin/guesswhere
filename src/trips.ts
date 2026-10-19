import { distanceKm, type LatLng } from './geo';

/** Écart de temps à partir duquel deux photos consécutives appartiennent à deux voyages. */
export const TRIP_GAP_MS = 3 * 24 * 3600 * 1000;
/** Écart de distance à partir duquel deux photos consécutives appartiennent à deux voyages. */
export const TRIP_GAP_KM = 500;

export interface Dated extends LatLng {
  takenAt: number; // ms epoch
}

/**
 * Regroupe automatiquement les photos en voyages : une nouvelle série commence
 * après plus de 3 jours ou plus de 500 km depuis la photo précédente.
 * Les voyages et leurs photos sont triés du plus ancien au plus récent.
 */
export function groupIntoTrips<T extends Dated>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => a.takenAt - b.takenAt);
  const trips: T[][] = [];
  for (const item of sorted) {
    const current = trips[trips.length - 1];
    const last = current?.[current.length - 1];
    if (!last || item.takenAt - last.takenAt > TRIP_GAP_MS || distanceKm(last, item) > TRIP_GAP_KM) {
      trips.push([item]);
    } else {
      current.push(item);
    }
  }
  return trips;
}
