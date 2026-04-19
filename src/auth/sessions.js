import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed session cookies (HMAC-SHA256).
 *
 * Cookie format: "<payload_b64url>.<signature_b64url>"
 * Payload is a compact JSON object: { uid, r, exp }
 *   uid — user id
 *   r   — role ('employer' | 'employee')
 *   exp — unix seconds at which the session expires
 *
 * The signing key is DERIVED from the master key via HMAC, so it's stable
 * across restarts but never written to disk. If the master key changes,
 * all sessions invalidate automatically.
 */

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const SIGNING_INFO = 'pica:session-signing:v1';

export function deriveSessionKey(masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError('masterKey must be a 32-byte Buffer');
  }
  return createHmac('sha256', masterKey).update(SIGNING_INFO).digest();
}

function base64urlEncode(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str) {
  const pad = (4 - (str.length % 4)) % 4;
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad), 'base64');
}

/**
 * Sign a session payload. Returns the cookie value.
 * If ttlSeconds is not provided, uses the default (7 days).
 */
export function signSession({ uid, role }, sessionKey, ttlSeconds = SESSION_TTL_SECONDS) {
  if (!uid || typeof uid !== 'string') throw new TypeError('uid is required');
  if (!role || typeof role !== 'string') throw new TypeError('role is required');

  const payload = {
    uid,
    r: role,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', sessionKey).update(encoded).digest();
  return `${encoded}.${base64urlEncode(sig)}`;
}

/**
 * Verify a session cookie value. Returns the payload { uid, role, exp } on
 * success, or null if the signature, format, or expiry check fails.
 *
 * Never throws for malformed input — returns null for anything invalid.
 */
export function verifySession(cookieValue, sessionKey) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;

  const dot = cookieValue.indexOf('.');
  if (dot < 0) return null;

  const encoded = cookieValue.slice(0, dot);
  const providedSigB64 = cookieValue.slice(dot + 1);
  if (!encoded || !providedSigB64) return null;

  let providedSig, expectedSig;
  try {
    providedSig = base64urlDecode(providedSigB64);
    expectedSig = createHmac('sha256', sessionKey).update(encoded).digest();
  } catch {
    return null;
  }

  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(encoded).toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.uid !== 'string' || typeof payload.r !== 'string') return null;
  if (typeof payload.exp !== 'number') return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;

  return { uid: payload.uid, role: payload.r, exp: payload.exp };
}

export { SESSION_TTL_SECONDS };
