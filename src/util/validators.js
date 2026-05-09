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
