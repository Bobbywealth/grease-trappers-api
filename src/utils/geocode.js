/**
 * src/utils/geocode.js — Reverse geocode lat/lng to a human-readable address.
 *
 * Uses OpenStreetMap Nominatim (free, no API key). 1 req/sec limit per their
 * usage policy, which is fine for clock-in/clock-out (low frequency).
 * Caches results in-memory for 24h to avoid repeat lookups.
 */
const https = require('https');

const cache = new Map(); // key = "lat,lng" rounded to 4 decimals → address
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function reverseGeocode(lat, lng) {
  return new Promise((resolve) => {
    if (lat == null || lng == null) return resolve(null);
    const key = cacheKey(lat, lng);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return resolve(cached.address);
    }
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json&zoom=18&addressdetails=1`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'GreaseTrappersCRM/1.0 (admin@greasetrapers.com)',
        'Accept': 'application/json',
      },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const addr = formatAddress(j);
          cache.set(key, { address: addr, ts: Date.now() });
          resolve(addr);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function formatAddress(j) {
  if (!j || !j.address) return j?.display_name || null;
  const a = j.address;
  // Build a clean line: "123 Main St, City, NJ 07030"
  const parts = [];
  if (a.house_number && a.road) parts.push(`${a.house_number} ${a.road}`);
  else if (a.road) parts.push(a.road);
  const city = a.city || a.town || a.village || a.hamlet || a.suburb;
  if (city) parts.push(city);
  if (a.state) parts.push(a.state);
  if (a.postcode) parts.push(a.postcode);
  return parts.length ? parts.join(', ') : (j.display_name || null);
}

module.exports = { reverseGeocode };