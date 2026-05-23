// Shared best-effort geolocation for punch clocking. Browser-only.
// Mirrors the fast-path that public/punch.js uses (cached fix + a single
// short low-accuracy attempt, else punch without geo — the server accepts
// no-geo punches). The next plan migrates punch.js onto this module.

const GEO_CACHE_KEY = 'pica-last-geo-fix';
const FAST_TIMEOUT_MS = 3000;            // hard budget for the click path
const FIX_FRESH_MS = 5 * 60 * 1000;      // reuse a cached fix this recent

export function readCachedFix() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (!raw) return null;
    const fix = JSON.parse(raw);
    if (typeof fix?.lat === 'number' && typeof fix?.lng === 'number') return fix;
  } catch { /* ignore */ }
  return null;
}

export function saveCachedFix(fix) {
  try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ ...fix, ts: new Date().toISOString() })); }
  catch { /* ignore */ }
}

// Resolve {geo, geoSkipReason}. Never rejects — clocking must not be blocked
// by geolocation (matches the 0.22.2 non-blocking behavior).
export function getGeoFast() {
  return new Promise((resolve) => {
    // 1) A fresh cached fix → instant, no platform prompt.
    const cached = readCachedFix();
    if (cached?.ts && Date.now() - new Date(cached.ts).getTime() < FIX_FRESH_MS) {
      return resolve({ geo: { lat: cached.lat, lng: cached.lng, accuracy: cached.accuracy }, geoSkipReason: undefined });
    }
    // 2) No geolocation API → skip.
    if (!('geolocation' in navigator)) {
      return resolve({ geo: undefined, geoSkipReason: 'unsupported' });
    }
    // 3) One short low-accuracy attempt with a hard budget. The JS `budget`
    // timer is authoritative; the `options.timeout` below mirrors it only so
    // the platform stops early too. `settled`/`done()` make the first of
    // {budget, success, error} win and the rest no-ops — keep the two timeout
    // values equal so neither path double-fires.
    let settled = false;
    const done = (out) => { if (!settled) { settled = true; resolve(out); } };
    const budget = setTimeout(() => done({ geo: undefined, geoSkipReason: 'timeout' }), FAST_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(budget);
        const geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        saveCachedFix(geo);
        done({ geo, geoSkipReason: undefined });
      },
      (err) => {
        clearTimeout(budget);
        const reason = err && err.code === 1 ? 'denied' : err && err.code === 3 ? 'timeout' : 'unavailable';
        done({ geo: undefined, geoSkipReason: reason });
      },
      { enableHighAccuracy: false, timeout: FAST_TIMEOUT_MS, maximumAge: FIX_FRESH_MS },
    );
  });
}

// Clock in or out. type ∈ {'in','out'}. Resolves the parsed JSON ({ok, punch})
// or throws an Error whose .errorCode (if any) the caller can translate.
export async function clockPunch(type, { comment } = {}) {
  const url = type === 'in' ? '/api/punches/clock-in' : '/api/punches/clock-out';
  const { geo, geoSkipReason } = await getGeoFast();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      comment: comment || undefined,
      geo,
      geoSkipReason: geo ? undefined : (geoSkipReason || 'unavailable'),
      clientId: (crypto?.randomUUID && crypto.randomUUID()) || String(Date.now()),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `clock-${type} failed`);
    e.errorCode = data.errorCode;
    throw e;
  }
  return data;
}
