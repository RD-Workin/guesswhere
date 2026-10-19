import { describe, expect, it } from 'vitest';
import { newShareCode, normalizeCode, packGame, unpackGame, MAX_FILE_BYTES, SHARE_TTL_MS } from '../src/share';

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
    const file = await packGame({ id: 'abc', createdAt: Date.now(), expiresAt: Date.now() + 1000, from: 'Romain', rounds: [{ image: jpeg(1), lat: 35.6586, lng: 139.7454 }, { image: jpeg(2), lat: -22.95, lng: -43.21 }] }, code);
    const back = await unpackGame(file, code);
    expect(back.from).toBe('Romain');
    expect(back.id).toBe('abc');
    // Arrondi à ≈ 100 m : l'ami n'a pas l'adresse exacte.
    expect(back.rounds.map((r) => [r.lat, r.lng])).toEqual([[35.659, 139.745], [-22.95, -43.21]]);
    expect([...new Uint8Array(await back.rounds[1].image.arrayBuffer())]).toEqual([0xff, 0xd8, 2, 2, 0xff, 0xd9]);
  });

  it('rien de lisible sans le code', async () => {
    const file = await packGame({ id: 'abc', createdAt: 1, expiresAt: Date.now() + 1000, from: 'Romain', rounds: [{ image: jpeg(1), lat: 35.6586, lng: 139.7454 }] }, newShareCode());
    const text = new TextDecoder('latin1').decode(await file.arrayBuffer());
    expect(text).not.toContain('Romain');
    expect(text).not.toContain('35.6586');
    await expect(unpackGame(file, newShareCode())).rejects.toThrow('Code incorrect');
    await expect(unpackGame(new Blob(['nimporte']), newShareCode())).rejects.toThrow('pas une partie');
  });
});

describe('expiration', () => {
  it('refuse une partie expirée', async () => {
    const code = newShareCode();
    const file = await packGame({ id: 'x', createdAt: 0, expiresAt: 1000, from: 'R', rounds: [{ image: jpeg(1), lat: 1, lng: 1 }] }, code);
    await expect(unpackGame(file, code, 500)).resolves.toBeTruthy();
    await expect(unpackGame(file, code, 2000)).rejects.toThrow('expiré');
  });
});

describe('fichier reçu piégé', () => {
  const game = (over: object) => ({ id: 'x', createdAt: Date.now(), expiresAt: Date.now() + 1000, from: 'R', rounds: [{ image: jpeg(1), lat: 1, lng: 1 }], ...over });

  it('refuse un fichier trop gros avant de le lire', async () => {
    await expect(unpackGame(new Blob([new Uint8Array(MAX_FILE_BYTES + 1)]), newShareCode())).rejects.toThrow('trop gros');
  });

  it('refuse plus de 15 photos, une position impossible ou un prénom trop long', async () => {
    const code = newShareCode();
    const many = Array.from({ length: 16 }, (_, i) => ({ image: jpeg(i), lat: 1, lng: 1 }));
    await expect(unpackGame(await packGame(game({ rounds: many }), code), code)).rejects.toThrow('invalide');
    await expect(unpackGame(await packGame(game({ rounds: [{ image: jpeg(1), lat: 95, lng: 1 }] }), code), code)).rejects.toThrow('invalide');
    await expect(unpackGame(await packGame(game({ from: 'x'.repeat(41) }), code), code)).rejects.toThrow('invalide');
  });

  it('l’expéditeur ne peut pas dépasser 7 jours', async () => {
    const code = newShareCode();
    const file = await packGame(game({ createdAt: 0, expiresAt: 1e15 }), code);
    await expect(unpackGame(file, code, SHARE_TTL_MS - 1)).resolves.toBeTruthy();
    await expect(unpackGame(file, code, SHARE_TTL_MS + 1)).rejects.toThrow('expiré');
  });
});
