import { cleanTest } from './cryptotest';
import type { Photo } from './photos';

const DB_NAME = 'guesswhere';
const DB_VERSION = 3;
const PHOTOS = 'photos';
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

/** Supprime la base des photos et des parties reçues, sans rien laisser derrière. */
async function deleteDatabase(): Promise<void> {
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
  try { sessionStorage.clear(); } catch { /* stockage indisponible */ }
}

/**
 * Efface les photos seulement : copies, positions, dates, voyages, parties
 * reçues et base du test de chiffrement. Garde la vue satellite et l'app
 * hors ligne, qui ne contiennent aucune donnée personnelle (le même fichier
 * pour tout le monde, et le code de l'app).
 */
export async function wipePhotos(): Promise<void> {
  await deleteDatabase();
}

/**
 * Efface tout ce que l'app a stocké sur le téléphone : photos, réglages,
 * cache hors ligne, vue satellite et service worker.
 */
export async function wipeEverything(): Promise<void> {
  await deleteDatabase();
  try { localStorage.clear(); } catch { /* stockage indisponible */ }
  if ('caches' in window) {
    for (const key of await caches.keys()) await caches.delete(key);
  }
  if ('serviceWorker' in navigator) {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
  }
}
