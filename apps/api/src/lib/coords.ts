// Coordinates as written on a map screenshot: Google Maps shows 19°11'29.2"N 73°10'43.6"E in the
// search box, or 19.191444, 73.178778 on a dropped pin.

/** Latitude / longitude from text in degrees-minutes-seconds, degrees-minutes or decimal degrees; null when none. */
export function parseLatLng(text: string | null | undefined): { lat: number; lng: number } | null {
  if (!text) return null;
  const t = text.replace(/[′’]/g, "'").replace(/[″”]|''/g, '"').replace(/º|˚/g, '°');
  // 19°11'29.2"N (hemisphere after) or N 19° 11.487' (before); tried separately so one never takes the other's letter
  const num = String.raw`(\d{1,3}(?:\.\d+)?)\s*°\s*(?:(\d{1,2}(?:\.\d+)?)\s*'\s*(?:(\d{1,2}(?:\.\d+)?)\s*")?)?`;
  for (const [re, hi] of [[new RegExp(`${num}\\s*([NSEW])`, 'gi'), 4], [new RegExp(`([NSEW])\\s*${num}`, 'gi'), 1]] as const) {
    const found: { v: number; h: string }[] = [];
    for (const m of t.matchAll(re)) {
      const h = m[hi].toUpperCase();
      const [d, mi, se] = hi === 4 ? [m[1], m[2], m[3]] : [m[2], m[3], m[4]];
      const v = Number(d) + Number(mi ?? 0) / 60 + Number(se ?? 0) / 3600;
      found.push({ v: h === 'S' || h === 'W' ? -v : v, h });
    }
    const lat = found.find((x) => x.h === 'N' || x.h === 'S');
    const lng = found.find((x) => x.h === 'E' || x.h === 'W');
    if (lat && lng) return valid(lat.v, lng.v);
  }
  const dec = t.match(/(-?\d{1,2}\.\d{3,})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,})/);
  return dec ? valid(Number(dec[1]), Number(dec[2])) : null;
}

function valid(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/** The coordinates read from a map screenshot: the text as written wins over numbers the model worked out. */
export function mapCoords(text: string | null | undefined, lat: number | null | undefined, lng: number | null | undefined) {
  return parseLatLng(text) ?? (typeof lat === 'number' && typeof lng === 'number' ? valid(lat, lng) : null);
}
