import type { Photo } from './photos';

const DB_NAME = 'guesswhere';
const DB_VERSION = 3;
const PHOTOS = 'photos';
const SENT = 'envois';
const RECEIVED = 'recus';

let dbPromise: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Mise à jour du schéma : on ajoute seulement ce qui manque, sans jamais
    // effacer de données existantes.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTOS)) db.createObjectStore(PHOTOS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SENT)) db.createObjectStore(SENT, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(RECEIVED)) db.createObjectStore(RECEIVED, { keyPath: 'id' });
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

/** Partie envoyée à un ami : on garde les bonnes réponses pour lire son code de résultat. */
export interface SentGame {
  id: string;
  createdAt: number;
  answers: { lat: number; lng: number }[];
}

export async function saveSentGame(g: SentGame): Promise<void> {
  await done((await store('readwrite', SENT)).put(g));
}

export async function getSentGame(id: string): Promise<SentGame | undefined> {
  return done((await store('readonly', SENT)).get(id) as IDBRequest<SentGame | undefined>);
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

export async function countSentGames(): Promise<number> {
  return done((await store('readonly', SENT)).count());
}

export async function addPhoto(photo: Photo): Promise<void> {
  await done((await store('readwrite')).put(photo));
}

export async function allPhotos(): Promise<Photo[]> {
  return done((await store('readonly')).getAll() as IDBRequest<Photo[]>);
}

export async function deletePhotos(ids: string[]): Promise<void> {
  const s = await store('readwrite');
  await Promise.all(ids.map((id) => done(s.delete(id))));
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
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* stockage indisponible */ }
  if ('caches' in window) {
    for (const key of await caches.keys()) await caches.delete(key);
  }
  if ('serviceWorker' in navigator) {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
  }
}
