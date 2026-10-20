import { cleanTest } from './cryptotest';
import type { Photo } from './photos';
import { isSealed, openPhoto, sealPhoto, type SealedPhoto } from './vault';

const DB_NAME = 'guesswhere';
const DB_VERSION = 4;
const PHOTOS = 'photos';
const RECEIVED = 'recus';
const KEYS = 'cles'; // une clé non exportable par photo (vault.ts)

let dbPromise: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Mise à jour du schéma : on ajoute seulement ce qui manque, sans jamais
    // effacer de données existantes.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTOS)) db.createObjectStore(PHOTOS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(RECEIVED)) db.createObjectStore(RECEIVED, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      // Une autre fenêtre demande la suppression : on libère la base.
      req.result.onversionchange = () => {
        req.result.close();
        dbPromise = undefined;
      };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(mode: IDBTransactionMode, name = PHOTOS) {
  return (await open()).transaction(name, mode).objectStore(name);
}

/**
 * Partie reçue d'un ami, gardée chiffrée avec son code jusqu'à la fin de la
 * partie ou jusqu'à l'expiration, pour pouvoir la reprendre (securite-rgpd.md §16 bis).
 * Les photos ne sont déchiffrées qu'en mémoire, à chaque ouverture.
 */
export interface ReceivedGame {
  id: string;
  file: Blob; // fichier chiffré tel que reçu
  code: string;
  from: string;
  player: string;
  expiresAt: number;
  guesses: { lat: number; lng: number }[]; // réponses déjà données, dans l'ordre
}

export async function saveReceivedGame(g: ReceivedGame): Promise<void> {
  await done((await store('readwrite', RECEIVED)).put(g));
}

export async function receivedGames(): Promise<ReceivedGame[]> {
  return done((await store('readonly', RECEIVED)).getAll() as IDBRequest<ReceivedGame[]>);
}

export async function deleteReceivedGame(id: string): Promise<void> {
  await done((await store('readwrite', RECEIVED)).delete(id));
}

/** Efface les parties reçues expirées (appelé à chaque ouverture de l'app). */
export async function purgeExpiredReceived(now = Date.now()): Promise<void> {
  for (const g of await receivedGames()) if (now > g.expiresAt) await deleteReceivedGame(g.id);
}


function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** Chiffre la photo puis écrit sa clé et l'enregistrement chiffré ensemble (tout ou rien). */
export async function addPhoto(photo: Photo): Promise<void> {
  const { key, record } = await sealPhoto(photo);
  const tx = (await open()).transaction([PHOTOS, KEYS], 'readwrite');
  tx.objectStore(KEYS).put({ id: photo.id, key });
  tx.objectStore(PHOTOS).put(record);
  await committed(tx);
}

/**
 * Photos déchiffrées en mémoire. `lost` : photos dont la clé a disparu ou ne
 * correspond plus (restauration de l'iPhone, mise à jour d'iOS) : illisibles, à réimporter.
 */
export async function loadPhotos(): Promise<{ photos: Photo[]; lost: string[] }> {
  const tx = (await open()).transaction([PHOTOS, KEYS], 'readonly');
  const [records, keys] = await Promise.all([
    done(tx.objectStore(PHOTOS).getAll() as IDBRequest<(Photo | SealedPhoto)[]>),
    done(tx.objectStore(KEYS).getAll() as IDBRequest<{ id: string; key: CryptoKey }[]>),
  ]);
  const keyOf = new Map(keys.map((k) => [k.id, k.key]));
  const photos: Photo[] = [];
  const lost: string[] = [];
  for (const r of records) {
    if (!isSealed(r)) { photos.push(r); continue; } // pas encore migrée
    const key = keyOf.get(r.id);
    try {
      if (!key) throw new Error('clé absente');
      photos.push(await openPhoto(r, key));
    } catch {
      lost.push(r.id);
    }
  }
  return { photos, lost };
}

export async function allPhotos(): Promise<Photo[]> {
  return (await loadPhotos()).photos;
}

/** Supprimer une photo supprime aussi sa clé : ce qui pourrait rester sur le disque devient illisible. */
export async function deletePhotos(ids: string[]): Promise<void> {
  const tx = (await open()).transaction([PHOTOS, KEYS], 'readwrite');
  for (const id of ids) {
    tx.objectStore(PHOTOS).delete(id);
    tx.objectStore(KEYS).delete(id);
  }
  await committed(tx);
}

/**
 * Chiffre les photos importées avant le chiffrement, une à une : chaque photo
 * est remplacée d'un bloc (clé + chiffré), donc une interruption ne perd rien
 * et la migration reprend à l'ouverture suivante. Renvoie le nombre migré.
 */
export async function migratePhotos(): Promise<number> {
  const records = await done((await store('readonly')).getAll() as IDBRequest<(Photo | SealedPhoto)[]>);
  let n = 0;
  for (const r of records) {
    if (isSealed(r)) continue;
    await addPhoto(r);
    n++;
  }
  return n;
}

/** Demande à Safari de ne pas purger les données (efficace surtout une fois l'app sur l'écran d'accueil). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/**
 * Efface tout ce que l'app a stocké sur le téléphone : photos, réglages,
 * cache hors ligne et service worker. Aucune donnée n'existe ailleurs
 * tant que le partage par lien n'est pas en place.
 */
export async function wipeEverything(): Promise<void> {
  if (dbPromise) {
    (await dbPromise).close();
    dbPromise = undefined;
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // Une autre fenêtre tient la base : on ne prétend pas avoir tout supprimé.
    req.onblocked = () => reject(new Error('Base de données ouverte ailleurs'));
  });
  await cleanTest();
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* stockage indisponible */ }
  if ('caches' in window) {
    for (const key of await caches.keys()) await caches.delete(key);
  }
  if ('serviceWorker' in navigator) {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
  }
}
