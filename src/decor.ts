import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { FeatureCollection, MultiPolygon } from 'geojson';
import landTopo from 'world-atlas/land-110m.json';
import { calm } from './fun';

const NS = 'http://www.w3.org/2000/svg';

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: SVGElement[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

const cloud = (x: number, y: number, k: number, cls: string) =>
  s('g', { class: cls },
    s('g', { transform: `translate(${x} ${y}) scale(${k})`, fill: 'rgba(255,255,255,.85)' },
      s('ellipse', { cx: 0, cy: 0, rx: 18, ry: 8 }),
      s('ellipse', { cx: -9, cy: -5, rx: 9, ry: 8 }),
      s('ellipse', { cx: 6, cy: -7, rx: 11, ry: 10 }),
    ),
  );

/**
 * Ciel de l'accueil : un avion traverse entre les nuages (étoiles en mode sombre).
 * Tout est dessiné ici, rien n'est chargé ; immobile si « Réduire les animations » est actif.
 */
export function heroArt(): SVGSVGElement {
  const route = 'M-20 70C60 20 120 100 190 60S300 20 360 50';
  const plane = s('g', { class: 'avion' },
    s('path', { d: 'M14 0c0-1.4-1.6-2-3-2H3L-4-11h-3l3 9h-7l-3-3h-2l1.5 5-1.5 5h2l3-3h7l-3 9h3l7-9h8c1.4 0 3-.6 3-2z', fill: '#fff' }),
  );
  if (calm()) plane.setAttribute('transform', 'translate(250 34) rotate(-12)');
  else plane.append(s('animateMotion', { dur: '9s', repeatCount: 'indefinite', rotate: 'auto', path: route }));
  const stars = [[24, 30], [92, 12], [210, 16], [300, 76], [250, 40], [140, 100], [330, 18]].map(([x, y], i) =>
    s('circle', { cx: x, cy: y, r: i % 2 ? 1.6 : 2.2, fill: '#fff', class: `scintille scintille-${i % 3}` }));
  return s('svg', { viewBox: '0 0 340 120', class: 'illustration', 'aria-hidden': 'true', focusable: 'false' },
    ...stars,
    cloud(60, 40, 1.1, 'nuage nuage-1'),
    cloud(280, 90, 0.9, 'nuage nuage-2'),
    s('path', { d: route, fill: 'none', stroke: 'rgba(255,255,255,.75)', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-dasharray': '2 8', class: 'trajet' }),
    plane,
  );
}

// Globe : terres Natural Earth 1/110 000 000 embarquées, en projection plate
// qui défile derrière un disque ombré (illusion de rotation, sans calcul 3D).
const R = 200;
const W = Math.round(2 * Math.PI * R);
const K = W / 360;
const Y0 = R - 90 * K;
const xy = (lng: number, lat: number) => `${((lng + 180) * K).toFixed(1)} ${((90 - lat) * K + Y0).toFixed(1)}`;

let landPath: string | undefined;
function land(): string {
  if (landPath) return landPath;
  const topo = landTopo as unknown as Topology;
  const geo = feature(topo, topo.objects.land as GeometryCollection) as unknown as FeatureCollection<MultiPolygon>;
  const parts: string[] = [];
  for (const f of geo.features) {
    for (const poly of f.geometry.coordinates) {
      for (const ring of poly) {
        if (ring.every(([, lat]) => lat < -55)) continue; // l'Antarctique, invisible sur ce disque
        let prev = ring[0][0];
        const pts = ring.map(([lng, lat]) => {
          // Contours continus à travers l'antiméridien.
          while (lng - prev > 180) lng -= 360;
          while (prev - lng > 180) lng += 360;
          prev = lng;
          return xy(lng, lat);
        });
        parts.push(`M${pts.join('L')}Z`);
      }
    }
  }
  return (landPath = parts.join(''));
}

/** Villes célèbres reliées en pointillés (décor seulement, sans lien avec les photos). */
const CITIES: [number, number, string][] = [
  [-74, 40.7, '#ff375f'], [2.35, 48.85, '#ff9f0a'], [31.2, 30, '#bf5af2'], [77.2, 28.6, '#ff9f0a'],
  [139.7, 35.7, '#0a84ff'], [151.2, -33.9, '#ff375f'], [18.4, -33.9, '#30d158'], [-43.2, -22.9, '#ff9f0a'],
];

function worldLayer(dx: number): SVGGElement {
  const pts = CITIES.map(([lng, lat]) => xy(lng, lat).split(' ').map(Number));
  const routes = pts.slice(1).map(([x, y], i) => {
    const [px, py] = pts[i];
    const mx = (px + x) / 2, my = Math.min(py, y) - Math.abs(x - px) * 0.18 - 10;
    return `M${px} ${py}Q${mx} ${my} ${x} ${y}`;
  }).join('');
  return s('g', { transform: `translate(${dx} 0)` },
    s('path', { d: land(), class: 'terres' }),
    s('path', { d: routes, class: 'routes', fill: 'none' }),
    ...pts.map(([x, y], i) => s('g', { transform: `translate(${x} ${y})` },
      s('path', { d: 'M0 0c-2-4-7-7-7-12a7 7 0 0 1 14 0c0 5-5 8-7 12z', fill: CITIES[i][2], stroke: '#fff', 'stroke-width': 2 }),
      s('circle', { cx: 0, cy: -12, r: 2.5, fill: '#fff' }),
    )),
  );
}

/** Grand globe qui tourne lentement en bas de l'accueil. */
export function globe(): SVGSVGElement {
  const shade = s('radialGradient', { id: 'globe-ombre', cx: '38%', cy: '30%', r: '75%' },
    s('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': 0.28 }),
    s('stop', { offset: '45%', 'stop-color': '#fff', 'stop-opacity': 0 }),
    s('stop', { offset: '100%', 'stop-color': '#001033', 'stop-opacity': 0.55 }),
  );
  return s('svg', { viewBox: `-12 -12 ${2 * R + 24} ${2 * R + 24}`, class: 'globe', 'aria-hidden': 'true', focusable: 'false' },
    s('defs', {}, shade, s('clipPath', { id: 'globe-disque' }, s('circle', { cx: R, cy: R, r: R }))),
    s('circle', { cx: R, cy: R, r: R + 8, class: 'atmosphere' }),
    s('circle', { cx: R, cy: R, r: R, class: 'ocean' }),
    s('g', { 'clip-path': 'url(#globe-disque)' }, s('g', { class: 'rotation' }, worldLayer(0), worldLayer(W))),
    s('circle', { cx: R, cy: R, r: R, fill: 'url(#globe-ombre)' }),
  );
}

/**
 * Logo de l'app, dessiné ici plutôt que chargé : après « Tout supprimer »,
 * l'accueil ne refait aucune requête qui recréerait le cache hors ligne.
 */
export function logo(): SVGSVGElement {
  return s('svg', { viewBox: '0 0 512 512', class: 'logo', 'aria-hidden': 'true', focusable: 'false' },
    s('rect', { width: 512, height: 512, rx: 112, fill: '#0a84ff' }),
    s('circle', { cx: 256, cy: 256, r: 150, fill: 'none', stroke: '#fff', 'stroke-width': 20 }),
    s('path', { d: 'M106 256h300M256 106c-60 60-60 240 0 300M256 106c60 60 60 240 0 300', fill: 'none', stroke: '#fff', 'stroke-width': 14, opacity: 0.55 }),
    s('path', { d: 'M256 150c-44 0-78 34-78 76 0 58 78 136 78 136s78-78 78-136c0-42-34-76-78-76z', fill: '#ff9f0a', stroke: '#fff', 'stroke-width': 12 }),
    s('circle', { cx: 256, cy: 226, r: 26, fill: '#fff' }),
  );
}
