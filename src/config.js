import fs from 'node:fs';
import path from 'node:path';

/**
 * Built-in defaults. Anything in config.json overrides these keys individually.
 * Keep the list short — every knob is a chance to misconfigure the app.
 */
const DEFAULTS = {
  host: '127.0.0.1',
  port: 8080,
  dataDir: './data',
  backupDir: './backups',
  maxBodyBytes: 5 * 1024 * 1024,        // 5 MB — pictures are resized client-side
  attachmentMaxBytes: 6 * 1024 * 1024,  // 6 MB — 5 MB leave file + multipart envelope
  backupMaxBytes: 200 * 1024 * 1024,    // 200 MB — restore upload ceiling
  logLevel: 'info',                     // debug | info | warn | error
};

const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

export function loadConfig(configPath) {
  let user = {};
  if (fs.existsSync(configPath)) {
    try {
      user = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new Error(`Failed to parse ${configPath}: ${err.message}`);
    }
  }

  const merged = { ...DEFAULTS, ...user };

  // Basic validation — fail loudly now rather than mysteriously later.
  if (!Number.isInteger(merged.port) || merged.port < 1 || merged.port > 65535) {
    throw new Error(`Invalid port: ${merged.port}`);
  }
  if (!Number.isInteger(merged.maxBodyBytes) || merged.maxBodyBytes < 1024) {
    throw new Error(`Invalid maxBodyBytes: ${merged.maxBodyBytes}`);
  }
  if (!Number.isInteger(merged.attachmentMaxBytes) || merged.attachmentMaxBytes < merged.maxBodyBytes) {
    throw new Error(`Invalid attachmentMaxBytes: ${merged.attachmentMaxBytes} (must be ≥ maxBodyBytes)`);
  }
  if (!Number.isInteger(merged.backupMaxBytes) || merged.backupMaxBytes < merged.maxBodyBytes) {
    throw new Error(`Invalid backupMaxBytes: ${merged.backupMaxBytes} (must be ≥ maxBodyBytes)`);
  }
  if (!VALID_LOG_LEVELS.has(merged.logLevel)) {
    throw new Error(`Invalid logLevel: ${merged.logLevel}. Expected one of ${[...VALID_LOG_LEVELS].join(', ')}`);
  }

  // Resolve relative paths against the config file's directory so the
  // server can be launched from anywhere.
  const baseDir = path.dirname(path.resolve(configPath));
  merged.dataDir  = path.resolve(baseDir, merged.dataDir);
  merged.backupDir = path.resolve(baseDir, merged.backupDir);

  // Mail is now an opaque AES-GCM blob ({ enc }) decrypted post-boot by
  // src/storage/mail-config.js (the master key isn't available here).
  // Pass it through untouched; never derive/normalise/throw on it.
  merged.mail = user.mail;

  return merged;
}
