import { describe, expect, it } from 'vitest';
import { isSealed, openPhoto, sealPhoto } from '../src/vault';
import type { Photo } from '../src/photos';

const photo: Photo = {
  id: 'a1b2', blob: new Blob([new Uint8Array([0xff, 0xd8, 1, 2, 3])], { type: 'image/jpeg' }),
  lat: 35.6586, lng: 139.7454, takenAt: 1700000000000, countryId: '392', countryName: 'Japon', addedAt: 1700000001000,
};

describe('chiffrement local des photos', () => {
  it('rend la photo, sa position et sa date à l’identique', async () => {
    const { key, record } = await sealPhoto(photo);
    expect(isSealed(record)).toBe(true);
    expect(key.extractable).toBe(false);
    const back = await openPhoto(record, key);
    expect({ ...back, blob: undefined }).toEqual({ ...photo, blob: undefined });
    expect(back.blob.type).toBe('image/jpeg');
    expect([...new Uint8Array(await back.blob.arrayBuffer())]).toEqual([0xff, 0xd8, 1, 2, 3]);
  });

  it('ne laisse en clair ni la position, ni le pays, ni l’image', async () => {
    const { record } = await sealPhoto(photo);
    expect(Object.keys(record).sort()).toEqual(['data', 'id', 'iv']);
    const text = new TextDecoder('latin1').decode(record.data);
    expect(text).not.toContain('Japon');
    expect(text).not.toContain('35.65');
  });

  it('refuse une autre clé', async () => {
    const { record } = await sealPhoto(photo);
    const { key: other } = await sealPhoto(photo);
    await expect(openPhoto(record, other)).rejects.toThrow();
  });

  it('refuse un enregistrement déplacé sous un autre identifiant', async () => {
    const { key, record } = await sealPhoto(photo);
    await expect(openPhoto({ ...record, id: 'autre' }, key)).rejects.toThrow();
  });

  it('reconnaît une photo pas encore migrée', () => {
    expect(isSealed(photo)).toBe(false);
  });
});
