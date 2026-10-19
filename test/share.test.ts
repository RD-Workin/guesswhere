import { describe, expect, it } from 'vitest';
import { decodeResult, encodeResult, newShareCode, normalizeCode, packGame, unpackGame } from '../src/share';

const jpeg = (n: number) => new Blob([new Uint8Array([0xff, 0xd8, n, n, 0xff, 0xd9])], { type: 'image/jpeg' });

describe('fichier de partage chiffré', () => {
  it('code de 26 caractères, aléatoire', () => {
    const a = newShareCode();
    expect(a).toMatch(/^[A-HJ-NP-Z2-9]{26}$/);
    expect(newShareCode()).not.toBe(a);
    expect(normalizeCode(a.toLowerCase().replace(/(.{5})/g, '$1-'))).toBe(a);
  });

  it('aller-retour', async () => {
    const code = newShareCode();
    const file = await packGame({ id: 'abc', createdAt: 1, from: 'Romain', rounds: [{ image: jpeg(1), lat: 35.6586, lng: 139.7454 }, { image: jpeg(2), lat: -22.95, lng: -43.21 }] }, code);
    const back = await unpackGame(file, code);
    expect(back.from).toBe('Romain');
    expect(back.id).toBe('abc');
    expect(back.rounds.map((r) => [r.lat, r.lng])).toEqual([[35.6586, 139.7454], [-22.95, -43.21]]);
    expect([...new Uint8Array(await back.rounds[1].image.arrayBuffer())]).toEqual([0xff, 0xd8, 2, 2, 0xff, 0xd9]);
  });

  it('rien de lisible sans le code', async () => {
    const file = await packGame({ id: 'abc', createdAt: 1, from: 'Romain', rounds: [{ image: jpeg(1), lat: 35.6586, lng: 139.7454 }] }, newShareCode());
    const text = new TextDecoder('latin1').decode(await file.arrayBuffer());
    expect(text).not.toContain('Romain');
    expect(text).not.toContain('35.6586');
    await expect(unpackGame(file, newShareCode())).rejects.toThrow('Code incorrect');
    await expect(unpackGame(new Blob(['nimporte']), newShareCode())).rejects.toThrow('pas une partie');
  });
});

describe('code de résultat', () => {
  it('aller-retour, même collé dans un message', () => {
    const code = encodeResult({ gameId: 'abc', player: 'Léa', guesses: [{ lat: 35.123456, lng: 139.5, score: 4057 }] });
    expect(code).toMatch(/^GWR1-[A-Za-z0-9_-]+$/);
    const r = decodeResult(`Mon score : ${code} 😀`);
    expect(r).toEqual({ gameId: 'abc', player: 'Léa', guesses: [{ lat: 35.1235, lng: 139.5, score: 4057 }] });
  });
  it('refuse un texte quelconque', () => {
    expect(() => decodeResult('bonjour')).toThrow('Aucun code');
    expect(() => decodeResult('GWR1-zzzz')).toThrow('illisible');
  });
});
