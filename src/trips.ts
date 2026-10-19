/** Écart de temps à partir duquel deux photos consécutives appartiennent à deux voyages. */
export const TRIP_GAP_MS = 3 * 24 * 3600 * 1000;

export interface Dated {
  takenAt: number; // ms epoch
}

/**
 * Regroupe automatiquement les photos en voyages : une nouvelle série commence
 * après plus de 3 jours sans photo. Pas de coupure à la distance, qui casserait
 * un voyage à chaque vol intérieur (décision C14). Les voyages et leurs photos
 * sont triés du plus ancien au plus récent.
 */
export function groupIntoTrips<T extends Dated>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => a.takenAt - b.takenAt);
  const trips: T[][] = [];
  for (const item of sorted) {
    const current = trips[trips.length - 1];
    const last = current?.[current.length - 1];
    if (!last || item.takenAt - last.takenAt > TRIP_GAP_MS) trips.push([item]);
    else current.push(item);
  }
  return trips;
}
