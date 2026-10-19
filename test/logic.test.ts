import { describe, expect, it } from 'vitest';
import { distanceKm, formatDistance } from '../src/geo';
import { roundScore, MAX_SCORE } from '../src/score';
import { startFrame } from '../src/framing';
import { groupIntoTrips } from '../src/trips';
import { advance, newGame, roundComplete, submitGuess, totals } from '../src/game';
import { countryAt } from '../src/countries';

const near = (actual: number, expected: number, pct = 0.5) =>
  expect(Math.abs(actual - expected) / expected * 100).toBeLessThanOrEqual(pct);

describe('distance (grille du fil « Chasse aux bugs »)', () => {
  it('même point', () => expect(distanceKm({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8566, lng: 2.3522 })).toBe(0));
  it('ville', () => near(distanceKm({ lat: 48.8584, lng: 2.2945 }, { lat: 48.853, lng: 2.3499 }), 4.1, 3));
  it('pays voisins', () => near(distanceKm({ lat: 48.8566, lng: 2.3522 }, { lat: 51.5074, lng: -0.1278 }), 344));
  it('continents', () => near(distanceKm({ lat: 48.8566, lng: 2.3522 }, { lat: 40.7128, lng: -74.006 }), 5837));
  it('antiméridien', () => near(distanceKm({ lat: -17.7, lng: 178 }, { lat: -13.8, lng: -172 }), 1100, 5));
  it('pôle', () => near(distanceKm({ lat: 89.9, lng: 0 }, { lat: 89.9, lng: 180 }), 22, 2));
  it('antipodes', () => near(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }), 20015));
  it('format français', () => {
    expect(formatDistance(0.42)).toBe('420 m');
    expect(formatDistance(2.44)).toBe('2,4 km');
    expect(formatDistance(1830)).toBe('1 830 km');
  });
});

describe('score logarithmique (C4, grille de bugs.md)', () => {
  it('valeurs de référence', () => {
    const grid: [number, number][] = [[0, 5000], [0.1, 5000], [0.8, 4148], [1, 4057], [3, 3607], [5, 3398], [10, 3114], [100, 2170], [344, 1664], [1000, 1227], [5837, 504], [20015, 0]];
    for (const [d, pts] of grid) expect(roundScore(d), `${d} km`).toBe(pts);
  });
  it('borné, monotone, sans NaN', () => {
    let prev = Infinity;
    for (let d = 0; d <= 20100; d += 10) {
      const s = roundScore(d);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(MAX_SCORE);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
    expect(roundScore(NaN)).toBe(0);
    expect(roundScore(-1)).toBe(0);
  });
});

describe('cadrage de départ', () => {
  it('ignore la photo isolée et reste fixe', () => {
    const tokyo = Array.from({ length: 9 }, (_, i) => ({ lat: 35.65 + i * 0.01, lng: 139.7 + i * 0.01 }));
    const f = startFrame([...tokyo, { lat: 48.85, lng: 2.35 }]);
    expect(f.west).toBeGreaterThan(139);
    expect(f.east).toBeLessThan(141);
  });
  it("traverse l'antiméridien", () => {
    const f = startFrame([{ lat: -17.7, lng: 178 }, { lat: -13.8, lng: -172 }, { lat: -18, lng: 179 }]);
    expect(f.east - f.west).toBeLessThan(30);
  });
});

describe('voyages', () => {
  const day = 86400000;
  it('coupe après 3 jours, pas à la distance (vol intérieur)', () => {
    const p = (takenAt: number, lat: number, lng: number) => ({ takenAt, lat, lng });
    const trips = groupIntoTrips([
      p(0, 35.68, 139.69), p(day, 35.69, 139.7), // Tokyo
      p(2 * day, 26.21, 127.68), // Okinawa le lendemain : même voyage
      p(10 * day, 48.85, 2.35), // Paris une semaine plus tard : nouveau voyage
    ]);
    expect(trips.map((t) => t.length)).toEqual([3, 1]);
  });
});

describe('partie', () => {
  const pool = [
    { id: 'a', lat: 48.8584, lng: 2.2945 },
    { id: 'b', lat: 48.853, lng: 2.3499 },
    { id: 'c', lat: 48.8867, lng: 2.3431 },
  ];
  it('duel : alternance puis manche suivante', () => {
    const g = newGame(pool, ['Léa', 'Tom'], 2);
    submitGuess(g, g.rounds[0]);
    expect(roundComplete(g)).toBe(false);
    expect(advance(g)).toBe(true);
    expect(g.player).toBe(1);
    submitGuess(g, { lat: 0, lng: 0 });
    expect(advance(g)).toBe(true);
    expect([g.round, g.player]).toEqual([1, 0]);
    submitGuess(g, g.rounds[1]);
    advance(g);
    submitGuess(g, g.rounds[1]);
    expect(advance(g)).toBe(false);
    expect(totals(g)).toEqual([2 * MAX_SCORE, MAX_SCORE + roundScore(distanceKm({ lat: 0, lng: 0 }, g.rounds[0]))]);
  });
  it('pas plus de manches que de photos', () => expect(newGame(pool, ['A'], 10).rounds).toHaveLength(3));
});

describe('pays hors ligne', () => {
  it('trouve le pays en français', () => {
    expect(countryAt({ lat: 35.6586, lng: 139.7454 })?.name).toBe('Japon');
    expect(countryAt({ lat: -22.9519, lng: -43.2105 })?.name).toBe('Brésil');
    expect(countryAt({ lat: 48.8584, lng: 2.2945 })?.id).toBe('FR');
  });
  it('photo sur la côte', () => expect(countryAt({ lat: 43.2951, lng: 5.3622 })?.id).toBe('FR')); // Vieux-Port, Marseille
  it('Tchoukotka, à l’ouest de 180°', () => expect(countryAt({ lat: 66.0, lng: -172.0 })?.id).toBe('RU'));
  it('pleine mer', () => expect(countryAt({ lat: 0, lng: -30 })).toBeUndefined());
});

describe('fond de carte', () => {
  it("aucune arête ne traverse l'antiméridien", async () => {
    const { worldGeoJson } = await import('../src/countries');
    let long = 0;
    for (const f of worldGeoJson.features) {
      if (f.id === '010') continue; // Antarctique : contour polaire
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const r of polys.flat()) for (let i = 1; i < r.length; i++) if (Math.abs(r[i][0] - r[i - 1][0]) > 180) long++;
    }
    expect(long).toBe(0);
  });
});
