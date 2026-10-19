"""Construit la vue satellite mondiale (NASA Blue Marble, domaine public) en PMTiles.

Exécuté par la GitHub Action de publication, jamais sur le téléphone. Le fichier
est le même pour tout le monde : le télécharger ne révèle aucun lieu.

  python3 scripts/satellite.py <dossier-cache> <dossier-sortie> [zoom-max]

Les tuiles JPEG d'origine sont gardées dans <dossier-cache> (cache d'Actions) pour
ne pas les retélécharger à chaque publication. Produit monde.pmtiles et
monde.json (taille, version, zoom max) que l'app lit avant de proposer le
téléchargement. Nécessite Pillow et la commande pmtiles (go-pmtiles).
"""
import hashlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

SOURCE = os.environ.get(
    'SATELLITE_SOURCE',
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
)
QUALITY = 70
LIMIT = 95 * 1024 * 1024  # GitHub Pages refuse les fichiers de plus de 100 Mo.


def fetch(cache, z, x, y):
    path = os.path.join(cache, str(z), str(x), f'{y}.jpg')
    if os.path.exists(path):
        return path
    url = SOURCE.format(z=z, x=x, y=y)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            break
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + '.part', 'wb') as f:
        f.write(data)
    os.replace(path + '.part', path)
    return path


def webp(path):
    img = Image.open(path).convert('RGB')
    out = io.BytesIO()
    img.save(out, 'WEBP', quality=QUALITY, method=6)
    return out.getvalue()


def main():
    cache, outdir = sys.argv[1], sys.argv[2]
    maxzoom = int(sys.argv[3]) if len(sys.argv) > 3 else 7
    os.makedirs(outdir, exist_ok=True)
    tiles = [(z, x, y) for z in range(maxzoom + 1) for x in range(2 ** z) for y in range(2 ** z)]
    with ThreadPoolExecutor(16) as pool:
        paths = list(pool.map(lambda t: fetch(cache, *t), tiles))

    mb = os.path.join(outdir, 'monde.mbtiles')
    if os.path.exists(mb):
        os.remove(mb)
    db = sqlite3.connect(mb)
    db.execute('CREATE TABLE metadata (name TEXT, value TEXT)')
    db.execute('CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)')
    meta = {
        'name': 'GuessWhere satellite', 'format': 'webp', 'type': 'baselayer',
        'minzoom': '0', 'maxzoom': str(maxzoom), 'bounds': '-180,-85.0511,180,85.0511',
        'attribution': 'NASA Blue Marble',
    }
    db.executemany('INSERT INTO metadata VALUES (?, ?)', meta.items())
    with ThreadPoolExecutor(os.cpu_count() or 2) as pool:
        for (z, x, y), data in zip(tiles, pool.map(webp, paths)):
            # MBTiles numérote les lignes depuis le sud (TMS).
            db.execute('INSERT INTO tiles VALUES (?, ?, ?, ?)', (z, x, 2 ** z - 1 - y, data))
    db.commit()
    db.close()

    pm = os.path.join(outdir, 'monde.pmtiles')
    if os.path.exists(pm):
        os.remove(pm)
    subprocess.run(['pmtiles', 'convert', mb, pm], check=True, stdout=subprocess.DEVNULL)
    os.remove(mb)
    size = os.path.getsize(pm)
    if size > LIMIT:
        sys.exit(f'monde.pmtiles fait {size} octets, au-delà de la limite de GitHub Pages : baisser le zoom max.')
    with open(pm, 'rb') as f:
        version = hashlib.sha256(f.read()).hexdigest()[:12]
    with open(os.path.join(outdir, 'monde.json'), 'w') as f:
        json.dump({'octets': size, 'version': version, 'zoomMax': maxzoom}, f)
    print(f'monde.pmtiles : {len(tiles)} tuiles, {size / 1e6:.1f} Mo, zoom max {maxzoom}')


if __name__ == '__main__':
    main()
