/**
 * Lightweight input validators reusable across routes and stores.
 *
 * Used as a defense-in-depth layer: the route handler validates at the
 * edge so we return a clean 400 with an errorCode, and the store
 * re-validates as a safety net in case a route forgets.
 */

/**
 * RFC 4122 UUID v4 format. Matches the output of `crypto.randomUUID()`.
 *
 * Rejects empty strings, non-strings, and anything containing path
 * traversal characters (slashes, backslashes, dots). This is the
 * primary defense against path traversal in storage paths that use
 * `path.join(dir, id + '.<suffix>')`.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Identify an uploaded image by its magic bytes. Returns 'png' | 'jpeg' |
 * 'gif' | 'webp', or null if the buffer is not one of those formats.
 *
 * Used at the upload edge (company logo, employee picture) so non-image
 * bytes are rejected with a clean error instead of being stored and later
 * served as a broken image. It is a format check, NOT an anti-malware
 * scan: a valid-but-hostile image still passes. The serving routes also
 * pin a safe Content-Type, so this is defense-in-depth, not the only line.
 *
 * Only the leading signature is checked (PNG's first 4 bytes, JPEG's
 * SOI+marker, GIF's "GIF8", WebP's RIFF/WEBP container) — enough to
 * distinguish the four allowed formats without parsing the whole file.
 */
export function sniffImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  // PNG: 89 50 4E 47 (full signature is 8 bytes; the first 4 identify it).
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  // JPEG: FF D8 FF.
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  // GIF: "GIF8".
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  // WebP: "RIFF" .... "WEBP".
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  return null;
}
