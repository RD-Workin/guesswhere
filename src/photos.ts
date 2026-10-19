import exifr from 'exifr';
import { countryAt } from './countries';

/** Côté le plus long de l'image de jeu, en pixels. */
export const MAX_SIDE = 1600;

export interface ExifInfo {
  lat?: number;
  lng?: number;
  takenAt?: number;
}

/** Lit la position et la date dans les métadonnées, localement. Rien n'est envoyé. */
export async function readExif(file: Blob): Promise<ExifInfo> {
  let data: Record<string, unknown> | undefined;
  try {
    data = await exifr.parse(file, {
      gps: true, tiff: true, exif: true,
      xmp: false, iptc: false, icc: false, jfif: false, ihdr: false,
      pick: ['latitude', 'longitude', 'DateTimeOriginal', 'CreateDate', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef'],
    });
  } catch {
    return {};
  }
  const info: ExifInfo = {};
  const lat = Number(data?.latitude);
  const lng = Number(data?.longitude);
  // (0, 0) est la valeur par défaut d'appareils sans fix GPS : on la rejette.
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) {
    info.lat = lat;
    info.lng = lng;
  }
  const date = data?.DateTimeOriginal ?? data?.CreateDate;
  if (date instanceof Date && !Number.isNaN(date.getTime())) info.takenAt = date.getTime();
  return info;
}

/**
 * Ré-encode l'image via un canvas, réduite à MAX_SIDE px.
 * Le fichier produit ne contient plus aucune métadonnée (EXIF, GPS, XMP, IPTC,
 * modèle d'appareil, miniature) : seuls les pixels sont recopiés.
 */
export async function cleanImage(file: Blob, maxSide = MAX_SIDE): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * ratio);
    const h = Math.round(bitmap.height * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponible');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    // Libère la mémoire du canvas tout de suite (Safari limite la mémoire canvas totale).
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('Ré-encodage impossible');
    return blob;
  } finally {
    bitmap.close();
  }
}

export interface Photo {
  id: string; // aléatoire : le nom d'origine (IMG_1234) n'est jamais conservé
  blob: Blob; // image nettoyée
  lat: number;
  lng: number;
  takenAt: number;
  countryId?: string;
  countryName?: string;
  addedAt: number;
}

export type ImportOutcome =
  | { kind: 'ok'; photo: Photo }
  | { kind: 'no-gps' }
  | { kind: 'error' };

export async function importFile(file: File): Promise<ImportOutcome> {
  const exif = await readExif(file);
  if (exif.lat === undefined || exif.lng === undefined) return { kind: 'no-gps' };
  try {
    const blob = await cleanImage(file);
    const country = countryAt({ lat: exif.lat, lng: exif.lng });
    return {
      kind: 'ok',
      photo: {
        id: crypto.randomUUID(),
        blob,
        lat: exif.lat,
        lng: exif.lng,
        takenAt: exif.takenAt ?? file.lastModified,
        countryId: country?.id,
        countryName: country?.name,
        addedAt: Date.now(),
      },
    };
  } catch {
    return { kind: 'error' };
  }
}
