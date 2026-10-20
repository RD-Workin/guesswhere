/**
 * Chiffrement local des photos (securite-rgpd.md §19) : chaque photo, avec sa
 * position, sa date et son pays, est chiffrée en AES-GCM par sa propre clé
 * WebCrypto non exportable. Supprimer la clé rend la photo illisible, même si
 * le stockage garde des restes. L'image en clair n'existe qu'en mémoire.
 */
import type { Photo } from './photos';

/** Ce qui est écrit sur le téléphone : seul l'identifiant aléatoire reste en clair. */
export interface SealedPhoto {
  id: string;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

export const isSealed = (r: object): r is SealedPhoto => 'data' in r && 'iv' in r && !('blob' in r);

type Meta = Omit<Photo, 'id' | 'blob'> & { type: string };

// L'identifiant est lié au chiffré : on ne peut pas échanger deux enregistrements.
const aad = (id: string) => new TextEncoder().encode(id);

export async function sealPhoto(p: Photo): Promise<{ key: CryptoKey; record: SealedPhoto }> {
  const { id, blob, ...rest } = p;
  const meta = new TextEncoder().encode(JSON.stringify({ ...rest, type: blob.type } satisfies Meta));
  const image = new Uint8Array(await blob.arrayBuffer());
  const plain = new Uint8Array(4 + meta.length + image.length);
  new DataView(plain.buffer).setUint32(0, meta.length);
  plain.set(meta, 4);
  plain.set(image, 4 + meta.length);
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(id) }, key, plain);
  return { key, record: { id, iv, data } };
}

/** Lève une erreur si la clé ne correspond pas ou si l'enregistrement est abîmé. */
export async function openPhoto(r: SealedPhoto, key: CryptoKey): Promise<Photo> {
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv, additionalData: aad(r.id) }, key, r.data));
  const len = new DataView(plain.buffer).getUint32(0);
  const { type, ...meta } = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + len))) as Meta;
  return { id: r.id, blob: new Blob([plain.subarray(4 + len)], { type }), ...meta };
}
