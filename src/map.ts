import * as maplibregl from 'maplibre-gl';
import type { LngLatBoundsLike, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Le worker de MapLibre est servi comme fichier de l'app (même origine, compatible CSP).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { worldGeoJson } from './countries';
import type { LatLng } from './geo';

maplibregl.setWorkerUrl(workerUrl);

const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * Fond de carte embarqué (frontières Natural Earth) : aucune tuile n'est
 * demandée à un tiers, la position révélée ne quitte donc jamais le téléphone.
 * Limite : pas de rues. Le fond détaillé auto-hébergé (PMTiles) viendra s'ajouter ici.
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

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      style: style(),
      center: [0, 20],
      zoom: 0.5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Natural Earth' }));
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

  /** Cadre la carte sur l'étendue de la sélection, avec 30 % de marge. */
  frame(points: LatLng[]) {
    if (!points.length) return;
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    let [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    const mLat = Math.max((n - s) * 0.3, 0.02);
    const mLng = Math.max((e - w) * 0.3, 0.02);
    s = Math.max(-85, s - mLat); n = Math.min(85, n + mLat);
    w = Math.max(-180, w - mLng); e = Math.min(180, e + mLng);
    this.map.fitBounds([[w, s], [e, n]] as LngLatBoundsLike, { animate: false, padding: 8 });
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

  whenReady(): Promise<void> {
    return this.map.loaded() ? Promise.resolve() : new Promise((r) => this.map.once('load', () => r()));
  }

  destroy() {
    this.map.remove();
  }
}
