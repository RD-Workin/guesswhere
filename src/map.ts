import * as maplibregl from 'maplibre-gl';
import type { LngLatBoundsLike, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Le worker de MapLibre est servi comme fichier de l'app (même origine, compatible CSP).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { PMTiles } from 'pmtiles';
import { worldGeoJson } from './countries';
import type { LatLng } from './geo';
import { openInstalled } from './satellite';

maplibregl.setWorkerUrl(workerUrl);

/**
 * Vue de départ de chaque manche : le monde entier, identique pour toutes les
 * parties. Un cadrage calculé sur les photos de la partie donnait la réponse
 * (une partie à une photo, ou un voyage dans une seule ville, était cadré dessus).
 */
const WORLD: LngLatBoundsLike = [[-170, -58], [180, 78]];

// Tuiles satellite lues dans le fichier local (voir satellite.ts), jamais sur le réseau.
let satellite: Promise<PMTiles | undefined> | undefined;
const satelliteArchive = () => (satellite ??= openInstalled().then((pm) => {
  if (!pm) satellite = undefined; // pas encore téléchargée : on réessaiera à la prochaine carte
  return pm;
}));

maplibregl.addProtocol('satellite', async (params) => {
  const [z, x, y] = params.url.replace('satellite://', '').split('/').map(Number);
  const tile = await (await satelliteArchive())?.getZxy(z, x, y);
  if (!tile) throw new Error('Tuile satellite absente');
  return { data: tile.data };
});

/** À appeler après un téléchargement ou une suppression de la vue satellite. */
export function resetSatellite() {
  satellite = undefined;
}

const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * Fond de carte embarqué (frontières Natural Earth) : aucune tuile n'est
 * demandée à un tiers, la position révélée ne quitte donc jamais le téléphone.
 * Limite : pas de rues. Si la vue satellite est téléchargée, elle remplace la
 * terre dessinée (voir addSatellite).
 */
function style(): StyleSpecification {
  const d = dark();
  return {
    version: 8,
    sources: { pays: { type: 'geojson', data: worldGeoJson } },
    layers: [
      { id: 'mer', type: 'background', paint: { 'background-color': d ? '#0b1e2d' : '#a9d3ee' } },
      { id: 'terre', type: 'fill', source: 'pays', paint: { 'fill-color': d ? '#2b3a2e' : '#eef0e2' } },
      { id: 'frontieres', type: 'line', source: 'pays', paint: { 'line-color': d ? '#6b7d6e' : '#9aa38c', 'line-width': 0.8 } },
    ],
  };
}

export interface MarkerSpec extends LatLng {
  color: string;
  label?: string;
}

export class GameMap {
  readonly map: maplibregl.Map;
  private markers: maplibregl.Marker[] = [];
  private onTap?: (p: LatLng) => void;
  private ready: Promise<void>;

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      style: style(),
      bounds: WORLD,
      fitBoundsOptions: { padding: 8 },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Natural Earth' }));
    this.ready = Promise.all([
      new Promise<void>((r) => (this.map.loaded() ? r() : this.map.once('load', () => r()))),
      satelliteArchive(),
    ]).then(([, pm]) => (pm ? this.addSatellite(pm) : undefined))
      .catch(() => undefined); // sans satellite, la carte dessinée reste jouable
    // Un « click » MapLibre n'est pas émis après un pincement ou un glisser :
    // zoomer ne pose donc jamais de repère par erreur.
    this.map.on('click', (e) => {
      const w = e.lngLat.wrap();
      this.onTap?.({ lat: w.lat, lng: w.lng });
    });
  }

  setTapHandler(fn?: (p: LatLng) => void) {
    this.onTap = fn;
  }

  /** Remet la vue de départ : le monde entier, quelle que soit la photo. */
  resetView() {
    this.map.fitBounds(WORLD, { animate: false, padding: 8 });
  }

  setMarkers(specs: MarkerSpec[]) {
    this.markers.forEach((m) => m.remove());
    this.markers = specs.map((s) => {
      const el = document.createElement('div');
      el.className = 'repere';
      el.style.setProperty('--c', s.color);
      if (s.label) el.textContent = s.label;
      return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([s.lng, s.lat]).addTo(this.map);
    });
  }

  /** Trace les lignes réponse → vraie position et cadre l'ensemble. */
  reveal(answer: LatLng, guesses: LatLng[]) {
    // Prend le chemin le plus court à travers l'antiméridien (Fidji ↔ Samoa).
    const unwrap = (p: LatLng) => {
      let lng = p.lng;
      while (lng - answer.lng > 180) lng -= 360;
      while (answer.lng - lng > 180) lng += 360;
      return [lng, p.lat];
    };
    const data: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: guesses.map((g) => ({
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: [unwrap(g), [answer.lng, answer.lat]] },
      })),
    };
    const src = this.map.getSource('lignes') as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(data);
    else {
      this.map.addSource('lignes', { type: 'geojson', data });
      this.map.addLayer({ id: 'lignes', type: 'line', source: 'lignes', paint: { 'line-color': dark() ? '#fff' : '#1c1c1e', 'line-width': 2, 'line-dasharray': [2, 2] } });
    }
    const pts = [[answer.lng, answer.lat], ...guesses.map(unwrap)];
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    this.map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 48, maxZoom: 12, duration: 600 });
  }

  clearReveal() {
    const src = this.map.getSource('lignes') as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: [] });
  }

  /** Les images satellite, sous les frontières et les repères. Au-delà du zoom max, elles sont agrandies. */
  private async addSatellite(pm: PMTiles) {
    const h = await pm.getHeader();
    this.map.addSource('satellite', {
      type: 'raster', tiles: ['satellite://{z}/{x}/{y}'], tileSize: 256,
      minzoom: h.minZoom, maxzoom: h.maxZoom, attribution: 'NASA Blue Marble',
    });
    this.map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite' }, 'frontieres');
    this.map.setLayoutProperty('terre', 'visibility', 'none');
    this.map.setPaintProperty('frontieres', 'line-color', 'rgba(255,255,255,0.55)');
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  destroy() {
    this.map.remove();
  }
}
