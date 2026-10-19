import { PMTiles, type RangeResponse, type Source } from 'pmtiles';

/**
 * Vue satellite mondiale (NASA Blue Marble, domaine public), construite par la
 * GitHub Action et publiée à côté de l'app. Le fichier est le même pour tout le
 * monde et il est téléchargé en entier, jamais par morceaux : ni GitHub ni
 * personne ne peut savoir quelles zones sont regardées. Il est gardé dans le
 * Cache Storage, hors du cache de l'app, pour survivre aux mises à jour.
 */
const CACHE = 'carte-satellite';
const FILE = './carte/monde.pmtiles';
const INFO = './carte/monde.json';
const VERSION_HEADER = 'x-version';

export interface SatelliteInfo {
  octets: number;
  version: string;
  zoomMax: number;
}

/** Ce que le site publie : taille et version. Absent hors connexion ou en développement. */
export async function publishedInfo(): Promise<SatelliteInfo | undefined> {
  try {
    const res = await fetch(INFO, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as SatelliteInfo) : undefined;
  } catch {
    return undefined;
  }
}

async function cached(): Promise<Response | undefined> {
  // caches.open créerait un cache vide : on vérifie d'abord qu'il existe.
  if (!('caches' in self) || !(await caches.has(CACHE))) return undefined;
  return (await caches.open(CACHE)).match(FILE);
}

/** Version installée sur ce téléphone, ou undefined. */
export async function installedVersion(): Promise<string | undefined> {
  return (await cached())?.headers.get(VERSION_HEADER) ?? undefined;
}

/** Télécharge le fichier en entier vers le Cache Storage, sans le garder en mémoire. */
export async function download(info: SatelliteInfo, onProgress: (fraction: number) => void): Promise<void> {
  const res = await fetch(FILE, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  let received = 0;
  const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      received += chunk.byteLength;
      onProgress(Math.min(1, received / info.octets));
      ctl.enqueue(chunk);
    },
  }));
  // Copie de travail d'abord : une version déjà installée reste utilisable si
  // le téléchargement échoue en route.
  const partial = FILE + '?partiel';
  const cache = await caches.open(CACHE);
  try {
    await cache.put(partial, new Response(counted, {
      headers: { 'content-type': 'application/octet-stream', [VERSION_HEADER]: info.version },
    }));
    if (received !== info.octets) throw new Error('Téléchargement incomplet');
    await cache.put(FILE, (await cache.match(partial))!);
  } finally {
    await cache.delete(partial);
  }
}

export async function remove(): Promise<void> {
  if ('caches' in self) await caches.delete(CACHE);
}

/** Lit l'archive par tranches directement dans le fichier local. */
export class BlobSource implements Source {
  constructor(private blob: Blob) {}
  getKey() {
    return 'satellite';
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: await this.blob.slice(offset, offset + length).arrayBuffer() };
  }
}

/** L'archive installée, prête à lire, ou undefined si la vue satellite n'est pas téléchargée. */
export async function openInstalled(): Promise<PMTiles | undefined> {
  try {
    const res = await cached();
    return res ? new PMTiles(new BlobSource(await res.blob())) : undefined;
  } catch {
    return undefined;
  }
}
