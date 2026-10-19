import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Geometry, Position } from 'geojson';
import countries from 'i18n-iso-countries';
import fr from 'i18n-iso-countries/langs/fr.json';
import topo from 'world-atlas/countries-50m.json';
import type { LatLng } from './geo';

countries.registerLocale(fr);

// Frontières Natural Earth au 1/50 000 000, embarquées dans l'app :
// le pays d'une photo est déduit sans jamais envoyer sa position à un service.
type CountryProps = { name: string };
export const worldGeoJson = feature(
  topo as unknown as Topology,
  (topo as unknown as Topology).objects.countries as GeometryCollection<CountryProps>,
) as FeatureCollection<Geometry, CountryProps>;

// Certains contours (Russie, Fidji) passent par l'antiméridien : ±180° alterne
// et des arêtes traversent toute la carte. On rend chaque contour continu
// (longitudes au-delà de 180°), ce que MapLibre sait afficher. L'Antarctique,
// qui fait le tour du pôle, est laissé tel quel.
for (const f of worldGeoJson.features) {
  if (f.id === '010') continue;
  const g = f.geometry;
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const ring of polygons.flat()) {
    for (let i = 1; i < ring.length; i++) {
      const d = ring[i][0] - ring[i - 1][0];
      if (d > 180) ring[i][0] -= 360;
      else if (d < -180) ring[i][0] += 360;
    }
  }
}

interface Indexed {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  polygons: Position[][][];
}

let index: Indexed[] | undefined;

function buildIndex(): Indexed[] {
  return worldGeoJson.features.flatMap((f) => {
    const g = f.geometry;
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (!polygons.length) return [];
    let [minX, minY, maxX, maxY] = [180, 90, -180, -90];
    for (const ring of polygons.flatMap((p) => p)) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const alpha2 = countries.numericToAlpha2(String(f.id ?? ''));
    const name = (alpha2 && countries.getName(alpha2, 'fr')) || f.properties.name;
    return [{ id: alpha2 ?? f.properties.name, name, bbox: [minX, minY, maxX, maxY], polygons }];
  });
}

function inRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(x: number, y: number, rings: Position[][]): boolean {
  return inRing(x, y, rings[0]) && !rings.slice(1).some((hole) => inRing(x, y, hole));
}

export interface Country {
  id: string; // ISO 3166-1 alpha-2 quand il existe
  name: string; // nom français
}

function strictCountryAt(lat: number, lng: number): Country | undefined {
  for (const c of (index ??= buildIndex())) {
    const [minX, minY, maxX, maxY] = c.bbox;
    if (lat < minY || lat > maxY) continue;
    // Les contours rendus continus peuvent dépasser 180° : on teste aussi lng ± 360.
    for (const x of [lng, lng + 360, lng - 360]) {
      if (x < minX || x > maxX) continue;
      if (c.polygons.some((p) => inPolygon(x, lat, p))) return { id: c.id, name: c.name };
    }
  }
  return undefined;
}

/**
 * Pays d'une photo. Les côtes étant simplifiées, une photo prise sur une plage
 * ou un port peut tomber « en mer » : on tente alors des points voisins (~10 km).
 */
export function countryAt({ lat, lng }: LatLng): Country | undefined {
  const exact = strictCountryAt(lat, lng);
  if (exact) return exact;
  const d = 0.1;
  for (const [dy, dx] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [d, -d], [-d, d], [-d, -d]]) {
    const near = strictCountryAt(lat + dy, lng + dx);
    if (near) return near;
  }
  return undefined;
}
