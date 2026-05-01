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
  maxBodyBytes: 5 * 1024 * 1024, // 5 MB — pictures are resized client-side
  logLevel: 'info',              // debug | info | warn | error
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
  if (!VALID_LOG_LEVELS.has(merged.logLevel)) {
    throw new Error(`Invalid logLevel: ${merged.logLevel}. Expected one of ${[...VALID_LOG_LEVELS].join(', ')}`);
  }

  // Resolve relative paths against the config file's directory so the
  // server can be launched from anywhere.
  const baseDir = path.dirname(path.resolve(configPath));
  merged.dataDir = path.resolve(baseDir, merged.dataDir);
  merged.backupDir = path.resolve(baseDir, merged.backupDir);

  return merged;
}
