// Map snapshots from coordinates. Google Static Maps (road + satellite) when a key is configured,
// otherwise an OpenStreetMap road map composed from tiles. Results are cached as files.
import sharp from 'sharp';
import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { readFile, saveFile } from '../../platform/storage.js';

const W = 640;
const H = 420;

async function fetchBuf(url: string) {
  const r = await fetch(url, { headers: { 'User-Agent': `ValueMitra/2.0 (${env.EMAIL_FROM ?? 'support'})` } });
  if (!r.ok) throw new Error(`Map tile ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const pin = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42"><path d="M15 0C7 0 0 6.6 0 15c0 10 15 27 15 27s15-17 15-27C30 6.6 23 0 15 0z" fill="#C62828" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>`);

async function osmMap(lat: number, lng: number, z = 17): Promise<Buffer> {
  const n = 2 ** z;
  const xt = ((lng + 180) / 360) * n;
  const yt = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const px = xt * 256;
  const py = yt * 256;
  const left = px - W / 2;
  const top = py - H / 2;
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  for (let tx = Math.floor(left / 256); tx <= Math.floor((left + W) / 256); tx++) {
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + H) / 256); ty++) {
      const img = await fetchBuf(`https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`);
      tiles.push({ input: img, left: Math.round(tx * 256 - left), top: Math.round(ty * 256 - top) });
    }
  }
  const canvas = sharp({ create: { width: W + 512, height: H + 512, channels: 3, background: '#eeeeee' } });
  const composed = await canvas.composite(tiles.map((t) => ({ ...t, left: t.left + 256, top: t.top + 256 }))).png().toBuffer();
  const cropped = await sharp(composed).extract({ left: 256, top: 256, width: W, height: H }).toBuffer();
  const attribution = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="18"><rect width="${W}" height="18" fill="white" fill-opacity="0.7"/><text x="${W - 6}" y="13" font-family="Arial" font-size="11" text-anchor="end" fill="#333">© OpenStreetMap contributors</text></svg>`);
  return sharp(cropped).composite([{ input: pin, left: W / 2 - 15, top: H / 2 - 42 }, { input: attribution, left: 0, top: H - 18 }]).jpeg({ quality: 85 }).toBuffer();
}

async function googleMap(lat: number, lng: number, type: 'roadmap' | 'satellite') {
  const u = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${type === 'satellite' ? 18 : 16}&size=${W}x${H}&scale=2&maptype=${type}&markers=color:red%7C${lat},${lng}&key=${env.GOOGLE_MAPS_API_KEY}`;
  return fetchBuf(u);
}

/** Returns map images (road, and satellite when available), cached per firm and position. */
export async function mapImages(firmId: number, lat: number, lng: number): Promise<{ label: string; buffer: Buffer }[]> {
  const key = `map_${lat.toFixed(5)}_${lng.toFixed(5)}`;
  const cached = await db.selectFrom('files').select(['id', 'original_name']).where('firm_id', '=', firmId).where('purpose', '=', 'map').where('original_name', 'like', `${key}%`).where('purged_at', 'is', null).execute();
  if (cached.length) {
    return Promise.all(cached.map(async (c) => ({ label: c.original_name!.includes('satellite') ? 'Satellite view' : 'Map', buffer: (await readFile(c.id, firmId)).buffer })));
  }
  const out: { label: string; buffer: Buffer }[] = [];
  if (env.GOOGLE_MAPS_API_KEY) {
    out.push({ label: 'Map', buffer: await googleMap(lat, lng, 'roadmap') });
    out.push({ label: 'Satellite view', buffer: await googleMap(lat, lng, 'satellite') });
  } else {
    out.push({ label: 'Map', buffer: await osmMap(lat, lng) });
  }
  for (const m of out) await saveFile({ firmId, purpose: 'map', buffer: m.buffer, name: `${key}_${m.label === 'Map' ? 'road' : 'satellite'}.jpg`, mime: 'image/jpeg' });
  return out;
}
