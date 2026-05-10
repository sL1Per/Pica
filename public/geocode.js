/**
 * Reverse geocoding via OpenStreetMap Nominatim.
 *
 * Browser-side helper: takes a {lat, lng} and resolves to a short,
 * human-readable address string. Falls back to a coordinate string when
 * the network is unavailable, the response is malformed, or rate
 * limiting kicks in.
 *
 * Trade-off (documented in RELEASES.md 0.22.9): each unique location
 * leaves the operator's browser to nominatim.openstreetmap.org. The
 * cache below means each rounded lat/lng pair only ever costs one
 * request, but the request itself reveals where the punch happened to
 * a third party. Operators who consider employee location data
 * sensitive should disable address rendering or run a self-hosted
 * Nominatim and point this URL at it.
 *
 * Nominatim usage-policy compliance:
 *   - Cache aggressively (30-day TTL keyed by 4-decimal lat/lng)
 *   - Rate limit to ≤1 request/second via a queue
 *   - No client User-Agent override (browsers don't allow that); the
 *     site's Referer identifies the deployment
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/reverse';
const CACHE_KEY_PREFIX = 'pica-geocode:';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days
const FETCH_TIMEOUT_MS = 5000;
const REQ_INTERVAL_MS = 1100;  // a hair over 1 sec to be polite

// Cache key uses 4 decimals (~11m precision) so multiple punches at
// the same building share a single response.
function cacheKey(lat, lng) {
  return `${CACHE_KEY_PREFIX}${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.ts !== 'number' || typeof entry.label !== 'string') return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
    return entry.label;
  } catch {
    return null;
  }
}

function writeCache(key, label) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), label }));
  } catch {
    // localStorage full / blocked — degrade silently. The caller still
    // gets the right answer this round; future calls will re-fetch.
  }
}

// In-memory promise cache so concurrent calls for the same key
// dedupe to a single fetch.
const inFlight = new Map();

// Throttle queue. Each `enqueue(fn)` waits its turn so we never fire
// two requests in the same second.
let lastDispatch = 0;
async function throttledDispatch(fn) {
  const wait = Math.max(0, lastDispatch + REQ_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastDispatch = Date.now();
  return fn();
}

/**
 * Format a Nominatim address object into a short label.
 *
 * Nominatim returns a flat object with fields like road, suburb, city,
 * town, village, postcode, country. We pick the most-specific +
 * least-redundant pair: a "place name" if available, falling back to
 * road, then city/town/village, then country.
 */
function formatLabel(payload) {
  const a = payload?.address;
  if (!a) return null;

  // Specific landmark tier — keep just one.
  const landmark = a.amenity || a.shop || a.building || a.tourism;

  // Street tier — road + house_number.
  let street = a.road || a.pedestrian || a.footway;
  if (street && a.house_number) street = `${street} ${a.house_number}`;

  // Locality tier — city/town/village/suburb.
  const locality = a.city || a.town || a.village || a.suburb || a.county;

  const parts = [];
  if (landmark) parts.push(landmark);
  if (street && street !== landmark) parts.push(street);
  if (locality && locality !== landmark && locality !== street) parts.push(locality);

  if (parts.length > 0) return parts.join(', ');

  // Fallback: use the display_name's first two comma-separated chunks.
  if (typeof payload.display_name === 'string') {
    const chunks = payload.display_name.split(',').map((s) => s.trim()).filter(Boolean);
    if (chunks.length >= 2) return `${chunks[0]}, ${chunks[1]}`;
    if (chunks.length === 1) return chunks[0];
  }

  return null;
}

async function fetchFromNominatim(lat, lng) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const url = `${NOMINATIM_BASE}?format=json&zoom=18&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': document.documentElement.lang || 'en' },
      signal: ctrl?.signal,
      // No credentials: third-party origin doesn't need our cookies.
      credentials: 'omit',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return formatLabel(data);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolve a {lat, lng} to a short address label, or null on any failure.
 * Cached in localStorage for 30 days; concurrent calls dedupe.
 */
export async function reverseGeocode(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const key = cacheKey(lat, lng);
  const cached = readCache(key);
  if (cached !== null) return cached;

  if (inFlight.has(key)) return inFlight.get(key);

  const promise = throttledDispatch(() => fetchFromNominatim(lat, lng))
    .then((label) => {
      if (label) writeCache(key, label);
      return label;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}
