import type { Photo } from './photos';

const DB_NAME = 'guesswhere';
const DB_VERSION = 1;
const PHOTOS = 'photos';

let dbPromise: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(PHOTOS, { keyPath: 'id' });
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

async function store(mode: IDBTransactionMode) {
  return (await open()).transaction(PHOTOS, mode).objectStore(PHOTOS);
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
