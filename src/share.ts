/**
 * Format du fichier de partage entre amis (.guesswhere) : chacun joue les
 * mêmes photos sur son téléphone et voit son score à la fin.
 *
 *   "GWH1" | IV (12 octets) | AES-GCM-256( longueur de l'en-tête (4 octets) | en-tête JSON | images JPEG bout à bout )
 *
 * La clé (128 bits aléatoires, dérivée en clé AES de 256 bits par HKDF) n'est
 * jamais dans le fichier : elle est transmise par un autre canal, sous forme
 * de 26 caractères. Les images sont celles déjà nettoyées à l'import (D4).
 * L'en-tête ne contient que ce dont le jeu a besoin : ni nom de voyage, ni
 * date de prise de vue, qui donneraient un indice à l'ami.
 */

const MAGIC = 'GWH1';
/** Nom neutre : il s'affiche en clair dans Messages et AirDrop (ni voyage, ni date). */
export const SHARE_FILE_NAME = 'partie.guesswhere';
/** Au plus 15 photos par partie partagée (≈ 3 à 5 Mo). */
export const MAX_SHARED_PHOTOS = 15;
/** Durée de vie d'une partie reçue (protection de confort : dépend de l'horloge de l'ami). */
export const SHARE_TTL_MS = 7 * 24 * 3600 * 1000;
/** Taille maximale d'un fichier reçu, vérifiée avant de le lire (15 photos ≈ 3 à 5 Mo). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Positions envoyées arrondies à 3 décimales (≈ 100 m) : l'ami n'a pas l'adresse exacte, et le score ne change pas (moins de 100 m = score maximal). */
const roundPos = (x: number) => Math.round(x * 1000) / 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 : pas de confusion à la lecture

export interface SharedRound {
  image: Blob;
  lat: number;
  lng: number;
}

export interface SharedGame {
  id: string; // identifiant aléatoire de la partie
  createdAt: number;
  expiresAt: number;
  from: string;
  rounds: SharedRound[];
}

interface Header {
  id: string;
  createdAt: number;
  expiresAt: number;
  from: string;
  rounds: { lat: number; lng: number; size: number }[];
}

export function newShareCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(17)); // 26 caractères × 5 bits = 130 bits ≥ 128
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** Normalise un code saisi à la main : majuscules, sans espaces ni tirets. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function keyFrom(code: string): Promise<CryptoKey> {
  const norm = normalizeCode(code);
  if (norm.length !== 26 || [...norm].some((c) => !ALPHABET.includes(c))) throw new Error('Code invalide : il doit faire 26 caractères.');
  const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(norm), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('guesswhere-partage-v1'), info: new Uint8Array() },
    raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function packGame(game: SharedGame, code: string): Promise<Blob> {
  const images = await Promise.all(game.rounds.map(async (r) => new Uint8Array(await r.image.arrayBuffer())));
  const header: Header = {
    id: game.id,
    createdAt: game.createdAt,
    expiresAt: game.expiresAt,
    from: game.from,
    rounds: game.rounds.map((r, i) => ({ lat: roundPos(r.lat), lng: roundPos(r.lng), size: images[i].length })),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, json.length);
  const plain = new Uint8Array(await new Blob([len, json, ...images]).arrayBuffer());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(code), plain);
  return new Blob([new TextEncoder().encode(MAGIC), iv, cipher], { type: 'application/octet-stream' });
}

const BAD_FILE = 'Fichier de partie invalide';

/** Vérifie l'en-tête déchiffré : il vient d'un ami qui a le code, pas forcément d'un fichier sain. */
function checkHeader(h: unknown, imagesBytes: number): Header {
  const ok = (c: boolean) => { if (!c) throw new Error(BAD_FILE); };
  const x = h as Header;
  ok(typeof x === 'object' && x !== null);
  ok(typeof x.id === 'string' && x.id.length > 0 && x.id.length <= 64);
  ok(typeof x.from === 'string' && x.from.length <= 40);
  ok(Number.isFinite(x.createdAt) && Number.isFinite(x.expiresAt));
  ok(Array.isArray(x.rounds) && x.rounds.length >= 1 && x.rounds.length <= MAX_SHARED_PHOTOS);
  let total = 0;
  for (const r of x.rounds) {
    ok(Number.isFinite(r.lat) && Math.abs(r.lat) <= 90 && Number.isFinite(r.lng) && Math.abs(r.lng) <= 180);
    ok(Number.isInteger(r.size) && r.size > 0);
    total += r.size;
  }
  ok(total === imagesBytes);
  return x;
}

export async function unpackGame(file: Blob, code: string, now = Date.now()): Promise<SharedGame> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Fichier trop gros pour une partie GuessWhere');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 4 + 12 + 16 || new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error('Ce fichier n’est pas une partie GuessWhere');
  const iv = bytes.subarray(4, 16);
  const key = await keyFrom(code); // « Code invalide » si le format est faux
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(16)));
  } catch {
    throw new Error('Code incorrect ou fichier abîmé');
  }
  if (plain.length < 4) throw new Error(BAD_FILE);
  const len = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
  if (len > 64 * 1024 || 4 + len > plain.length) throw new Error(BAD_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + len)));
  } catch {
    throw new Error(BAD_FILE);
  }
  const header = checkHeader(parsed, plain.length - 4 - len);
  // L'expéditeur ne peut pas allonger la durée de vie au-delà de 7 jours.
  const expiresAt = Math.min(header.expiresAt, header.createdAt + SHARE_TTL_MS);
  if (now > expiresAt) throw new Error('Cette partie a expiré (plus de 7 jours).');
  let offset = 4 + len;
  const rounds = header.rounds.map((r) => {
    const image = new Blob([plain.slice(offset, offset + r.size)], { type: 'image/jpeg' });
    offset += r.size;
    return { image, lat: r.lat, lng: r.lng };
  });
  return { id: header.id, createdAt: header.createdAt, expiresAt, from: header.from.slice(0, 20), rounds };
}
