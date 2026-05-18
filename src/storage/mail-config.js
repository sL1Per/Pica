// src/storage/mail-config.js
import fs from 'node:fs';
import { encryptBlob, decryptBlob } from '../crypto/aes.js';
import { writeConfigAtomic } from '../crypto/keyring.js';

/**
 * AES-256-GCM AAD that binds the ciphertext to this specific use-case.
 * Changing this string invalidates all existing blobs (intentional: it would
 * be a format migration, not silent data corruption).
 */
const AAD = 'pica-mail-config-v1';

const DEFAULTS = Object.freeze({
  enabled: false,
  host:    '',
  port:    465,
  secure:  true,
  user:    '',
  pass:    '',
  from:    '',
});

/**
 * Normalize raw user input to a well-typed config struct.
 * enabled must be strict boolean (not just truthy) — the UI sends real
 * booleans; if something else arrives it's not an intentional enable.
 * secure defaults true per the same logic (opt-out rather than opt-in).
 * port must be an integer or it defaults to 465.
 */
function normalize(o = {}) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) o = {};
  return {
    enabled: o.enabled === true,
    host:    typeof o.host === 'string' ? o.host.trim() : '',
    port:    Number.isInteger(o.port)   ? o.port        : 465,
    secure:  o.secure !== false,
    user:    typeof o.user === 'string' ? o.user : '',
    pass:    typeof o.pass === 'string' ? o.pass : '',
    from:    typeof o.from === 'string' ? o.from.trim() : '',
  };
}

/**
 * Owns the AES-256-GCM-encrypted SMTP config blob in config.json
 * (`"mail": { "enc": "<base64>" }`). Decrypted once on construct and
 * cached in memory — the mailer calls read() per send. Never throws:
 * an absent / malformed / undecryptable blob yields the safe disabled
 * default (mail simply off), mirroring the config/audit best-effort
 * convention. config.json is rewritten atomically (same mechanism the
 * passphrase/rotation operations use); it is gitignored and excluded
 * from backups, so SMTP config is intentionally not in backups.
 */
export function createMailConfigStore(configPath, masterKey, logger = null) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError('masterKey must be a 32-byte Buffer');
  }

  function loadRawConfig({ throws = false } = {}) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      if (throws) throw err;
      // config.json must exist by server start, but a read/parse failure
      // here is non-fatal for mail — SMTP simply stays disabled.
      logger?.warn?.('mail-config: could not read config; mail disabled');
      return {};
    }
  }

  let cache = { ...DEFAULTS };
  try {
    const raw = loadRawConfig(); // swallowing form: a failed read here just means mail disabled, no write follows
    const m = raw && raw.mail;
    // Only attempt decryption when mail is an object with a non-empty enc string.
    if (m && typeof m === 'object' && !Array.isArray(m) &&
        typeof m.enc === 'string' && m.enc) {
      const plain = decryptBlob(Buffer.from(m.enc, 'base64'), masterKey, AAD);
      cache = normalize(JSON.parse(plain.toString('utf8')));
    }
  } catch {
    // Decryption failure (wrong key, wrong AAD, truncated blob, bad JSON) →
    // treat as "no config" rather than crashing the server. The operator
    // must re-save their SMTP settings via the UI.
    // Note: assumes normalize() cannot throw; only decrypt/JSON failures reach here.
    logger?.warn?.('mail-config: could not decrypt; mail disabled until settings are re-saved');
    cache = { ...DEFAULTS };
  }

  function read() {
    return { ...cache };
  }

  function isConfigured() {
    // All five fields must be present for the mailer to be functional.
    return cache.enabled && !!(cache.host && cache.user && cache.pass && cache.from);
  }

  function publicView() {
    // pass is intentionally omitted — callers get a boolean instead.
    return {
      enabled:     cache.enabled,
      host:        cache.host,
      port:        cache.port,
      secure:      cache.secure,
      user:        cache.user,
      from:        cache.from,
      hasPassword: !!cache.pass,
    };
  }

  function write(patch = {}) {
    const incoming = (patch && typeof patch === 'object' && !Array.isArray(patch))
      ? patch : {};

    // pass is write-only: an absent key or an empty string preserves the
    // stored credential so the UI can update other fields without
    // accidentally clearing the password.
    const resolvedPass = (typeof incoming.pass === 'string' && incoming.pass !== '')
      ? incoming.pass : cache.pass;

    const next = normalize({ ...incoming, pass: resolvedPass });

    // throws:true — a failed read MUST abort the write rather than proceed on a
    // blank {} and clobber config.json (which would destroy security.wraps and
    // make the install unrecoverable). The swallowing form is fine at construct
    // time because no write follows a failed read there.
    const raw = loadRawConfig({ throws: true });
    raw.mail = {
      enc: encryptBlob(
        Buffer.from(JSON.stringify(next), 'utf8'),
        masterKey,
        AAD,
      ).toString('base64'),
    };
    writeConfigAtomic(configPath, raw);
    // cache updated ONLY after a successful persist — keeps memory/disk consistent; do not reorder.
    cache = next;
    return publicView();
  }

  return { read, isConfigured, publicView, write };
}
