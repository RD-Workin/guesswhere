// Génère des photos de test avec GPS (Tokyo, Rio : hémisphères S et W) et sans GPS.
const fs = require('fs');
const path = require('path');
const piexif = require('piexifjs');
const dir = path.join(__dirname, 'fixtures');
const base = fs.readFileSync(path.join(dir, 'base.jpg')).toString('binary');
const dms = (v) => {
  const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
  return [[d, 1], [m, 1], [Math.round(s * 1000), 1000]];
};
function write(name, lat, lng, date) {
  const exif = { '0th': { [piexif.ImageIFD.Make]: 'Apple', [piexif.ImageIFD.Model]: 'iPhone 15' }, Exif: {}, GPS: {} };
  if (date) exif.Exif[piexif.ExifIFD.DateTimeOriginal] = date;
  if (lat !== undefined) {
    exif.GPS[piexif.GPSIFD.GPSLatitudeRef] = lat < 0 ? 'S' : 'N';
    exif.GPS[piexif.GPSIFD.GPSLatitude] = dms(lat);
    exif.GPS[piexif.GPSIFD.GPSLongitudeRef] = lng < 0 ? 'W' : 'E';
    exif.GPS[piexif.GPSIFD.GPSLongitude] = dms(lng);
  }
  const out = piexif.insert(piexif.dump(exif), base);
  fs.writeFileSync(path.join(dir, name), Buffer.from(out, 'binary'));
}
write('tokyo.jpg', 35.6586, 139.7454, '2025:04:02 10:30:00');
write('rio.jpg', -22.9519, -43.2105, '2025:08:15 16:00:00');
write('sans-gps.jpg', undefined, undefined, '2025:08:16 09:00:00');
write('zero.jpg', 0, 0, '2025:08:16 09:00:00');
