/**
 * Security-headers middleware.
 *
 * Computes the SHA-256 hash of the canonical inline theme-bootstrap
 * script at construction time so we don't have to hard-code it. If
 * the bootstrap is ever edited, the hash auto-updates on next start.
 *
 * Headers applied:
 *
 *   Content-Security-Policy
 *     - default-src 'self'                — same-origin only by default
 *     - script-src  'self' 'sha256-…'     — local scripts + the one inline bootstrap
 *     - style-src   'self'                — local stylesheets only (no inline)
 *     - img-src     'self' data: blob:    — local + dataURLs (logo previews) + blob: (PWA icons)
 *     - connect-src 'self'                — fetch()/XHR/WebSocket back to the same origin
 *     - font-src    'self'                — local fonts only
 *     - object-src  'none'                — no <object> / <embed> at all
 *     - base-uri    'self'                — block <base> redirection
 *     - form-action 'self'                — forms can only post to same origin
 *     - frame-ancestors 'none'            — modern X-Frame-Options DENY
 *
 *   X-Content-Type-Options: nosniff       — block MIME sniffing
 *   X-Frame-Options: DENY                 — legacy-browser equivalent of frame-ancestors
 *   Referrer-Policy: strict-origin-when-cross-origin
 *   Permissions-Policy: geolocation=(self), camera=(), microphone=(),
 *                       payment=(), usb=(), interest-cohort=()
 *                       — Pica USES geolocation (clock-in coords); allow self only
 *   Strict-Transport-Security                — only when production AND
 *                                              X-Forwarded-Proto: https.
 *
 * The HSTS guard is conservative: setting it on plain HTTP would
 * upgrade-pin clients to HTTPS even if the deployment doesn't have it,
 * so we only emit the header when we can detect the request actually
 * came in over HTTPS via a TLS-terminating proxy.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Read one HTML file from publicDir, extract its inline <script>,
 * and return the SHA-256 hash in CSP format ('sha256-<base64>').
 *
 * Throws if no inline <script> can be found — this is intentional;
 * a Pica with no bootstrap would FOUC, which we want to know about.
 */
export function computeBootstrapHash(publicDir, filename = 'index.html') {
  const html = fs.readFileSync(path.join(publicDir, filename), 'utf8');
  // Match a <script> tag with NO attributes (the bootstrap has none).
  // Tags with `src=` or `type="module"` would have attributes and
  // wouldn't match. This is exactly what we want.
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error(`No inline <script> found in ${filename}`);
  }
  const sha = createHash('sha256').update(match[1], 'utf8').digest();
  return `'sha256-${sha.toString('base64')}'`;
}

/**
 * Build the security-headers applier.
 *
 * @param {object} opts
 * @param {string} opts.publicDir         used to compute the bootstrap hash
 * @param {boolean} opts.isProduction     gates HSTS
 * @returns {(req, res) => void}          call once per request
 */
export function createSecurityHeaders({ publicDir, isProduction }) {
  const scriptHash = computeBootstrapHash(publicDir);

  // Build the CSP once. Joining with `; ` is the spec-required
  // delimiter; trailing semicolons are tolerated but we omit them
  // for cleanliness.
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${scriptHash}`,
    "style-src 'self'",
    // OSM tiles are loaded directly into the punch-page map preview.
    // Without this allowance the map renders broken in strict browsers.
    // (Discovered as a pre-existing issue in 0.22.10 testing.)
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    // Nominatim is allowed for browser-side reverse geocoding of punch
    // coordinates (0.22.9). See public/geocode.js for the trade-off:
    // each unique location reveals where the punch happened to OSM.
    "connect-src 'self' https://nominatim.openstreetmap.org",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  const permissions = [
    'geolocation=(self)',     // clock-in records the punch location
    'camera=()',
    'microphone=()',
    'payment=()',
    'usb=()',
    'interest-cohort=()',     // opt out of FLoC (legacy but harmless)
  ].join(', ');

  return function applySecurityHeaders(req, res) {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', permissions);

    // HSTS: only when we can prove the request came in over HTTPS.
    // The X-Forwarded-Proto header is set by reverse proxies (Caddy,
    // nginx) when terminating TLS. In dev — even with isProduction
    // accidentally set — we don't pin clients to HTTPS without
    // evidence.
    if (isProduction && req.headers['x-forwarded-proto'] === 'https') {
      // 1 year, includeSubDomains. NOT preload by default — preload
      // submission is a separate operator decision. Adding it here
      // would commit ALL future deployments to HTTPS in a way that's
      // hard to reverse.
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  };
}
