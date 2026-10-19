/**
 * Test du chiffrement local sur le téléphone (idees-securite.md idée 5,
 * securite-rgpd.md §19), avec des données fictives dans une base à part :
 * on vérifie qu'une clé WebCrypto non exportable survit à la fermeture de
 * l'app avant de chiffrer les vraies photos.
 */

export const TEST_DB = 'guesswhere-test-chiffrement';
const STORE = 'test';
const IMAGES = 15;
const IMAGE_BYTES = 300 * 1024;

interface TestRecord {
  id: 'test';
  key: CryptoKey;
  items: { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer; hash: string }[];
}

export interface TestResult {
  decrypted: boolean;
  extractable: boolean;
  ms: number;
}

function openTestDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TEST_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openTestDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const hex = async (b: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (x) => x.toString(16).padStart(2, '0')).join('');

/** Données fictives de la taille d'une photo nettoyée. */
function fakeImage(): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(IMAGE_BYTES);
  for (let i = 0; i < out.length; i += 65536) crypto.getRandomValues(out.subarray(i, i + 65536));
  return out;
}

/** Un test est-il en cours (étape 1 faite, vérification à faire) ? */
export async function testPending(): Promise<boolean> {
  return (await withStore('readonly', (s) => s.count())) > 0;
}

/** Étape 1 : clé non exportable rangée dans IndexedDB, 15 images fictives chiffrées. */
export async function startTest(): Promise<void> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const items: TestRecord['items'] = [];
  for (let i = 0; i < IMAGES; i++) {
    const plain = fakeImage();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    items.push({ iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain), hash: await hex(plain) });
  }
  await withStore('readwrite', (s) => s.put({ id: 'test', key, items } satisfies TestRecord));
}

/** Étape 2, après réouverture : déchiffrement, clé non exportable, temps pour 15 images. */
export async function checkTest(): Promise<TestResult> {
  const rec = await withStore<TestRecord | undefined>('readonly', (s) => s.get('test'));
  if (!rec) throw new Error('Aucun test en cours');
  let decrypted = true;
  const t0 = performance.now();
  const plains: ArrayBuffer[] = [];
  for (const it of rec.items) {
    try {
      plains.push(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: it.iv }, rec.key, it.data));
    } catch {
      decrypted = false;
    }
  }
  const ms = Math.round(performance.now() - t0);
  if (decrypted) {
    for (let i = 0; i < plains.length; i++) if ((await hex(plains[i])) !== rec.items[i].hash) decrypted = false;
  }
  return { decrypted: decrypted && plains.length === IMAGES, extractable: rec.key.extractable, ms };
}

/** Efface la base de test. */
export function cleanTest(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(TEST_DB);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
