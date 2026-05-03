/**
 * Backups storage.
 *
 * A backup is a single encrypted file in `<backupsDir>/`. The filename
 * encodes the timestamp:
 *
 *   pica-backup-2026-05-03T091500Z-<id8>.bak
 *
 * - The timestamp is UTC, second-precision, with colons stripped so the
 *   filename is filesystem-safe everywhere.
 * - `<id8>` is the first 8 hex chars of the SHA-256 of the encrypted
 *   blob. Uniqueness across same-second creations + tampering tell-tale
 *   in the filename itself.
 *
 * Operations:
 *   create()           — snapshot the data dir + config into a new backup
 *   list()             — metadata for every backup
 *   read(id)           — raw encrypted bytes for download
 *   delete(id)         — permanently remove a backup file
 *   restore(blob)      — decrypt a backup and atomically swap it into data/
 *   pruneToKeep(n)     — keep newest N, delete older
 *
 * restore() is the dangerous operation. It:
 *   1. Decrypts and parses the blob (no filesystem changes if anything fails)
 *   2. Validates every path (must start with `data/`, no traversal)
 *   3. Writes to a staging directory `data.staging-<ts>/`
 *   4. Atomic swap: rename current data/ → data.pre-restore-<ts>/, then
 *      rename data.staging-<ts>/ → data/
 *   5. Returns metadata about what was restored
 *
 * `config.json` is intentionally NOT restored. Backups bundle it for
 * future cross-install support, but Drop 2 only handles same-install
 * restore — the running server's master key already matches, since
 * decryption succeeded with that key.
 */

import fs from 'node:fs';
import path from 'node:path';

import { packBackup, unpackBackup, backupId } from '../crypto/backup-archive.js';

const FILE_PREFIX = 'pica-backup-';
const FILE_SUFFIX = '.bak';

/**
 * Recursively list all regular files under `dir`, returning paths
 * relative to `dir`. Skips directories and other non-regular entries.
 * Returns paths sorted alphabetically for determinism (helps tests
 * compare backups byte-for-byte… well, except for the random salt/IV
 * inside, but the entry order is deterministic).
 */
function walkFiles(dir) {
  const out = [];
  function visit(absDir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const absPath = path.join(absDir, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(absPath, relPath);
      } else if (entry.isFile()) {
        out.push(relPath);
      }
      // Symlinks, sockets, etc. are silently skipped.
    }
  }
  visit(dir, '');
  out.sort();
  return out;
}

/**
 * UTC timestamp like "2026-05-03T091500Z" — sortable, filesystem-safe.
 */
function utcStamp(d = new Date()) {
  const pad2 = (n) => String(n).padStart(2, '0');
  const Y = d.getUTCFullYear();
  const M = pad2(d.getUTCMonth() + 1);
  const D = pad2(d.getUTCDate());
  const h = pad2(d.getUTCHours());
  const m = pad2(d.getUTCMinutes());
  const s = pad2(d.getUTCSeconds());
  return `${Y}-${M}-${D}T${h}${m}${s}Z`;
}

/**
 * Parse a backup filename to extract { timestamp, id }, or null if
 * the filename doesn't match.
 */
function parseFilename(name) {
  if (!name.startsWith(FILE_PREFIX) || !name.endsWith(FILE_SUFFIX)) return null;
  const middle = name.slice(FILE_PREFIX.length, -FILE_SUFFIX.length);
  // middle is "<timestamp>-<id8>"
  const dash = middle.lastIndexOf('-');
  if (dash < 0) return null;
  const timestamp = middle.slice(0, dash);
  const id        = middle.slice(dash + 1);
  if (!/^\d{4}-\d{2}-\d{2}T\d{6}Z$/.test(timestamp)) return null;
  if (!/^[0-9a-f]{8,16}$/.test(id)) return null;
  return { timestamp, id };
}

/**
 * @param {string} dataDir     Pica's data directory (read source)
 * @param {string} backupsDir  Where to write backups
 * @param {string} configPath  Path to config.json (included in backup)
 * @param {Buffer} masterKey   32-byte master key
 */
export function createBackupsStore({ dataDir, backupsDir, configPath, masterKey }) {
  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });

  function buildEntries() {
    const entries = [];

    // 1. config.json — required so a restored backup can decrypt employee data.
    if (fs.existsSync(configPath)) {
      entries.push({
        path: 'config.json',
        data: fs.readFileSync(configPath),
      });
    }

    // 2. everything under dataDir, paths relative to data/.
    if (fs.existsSync(dataDir)) {
      for (const rel of walkFiles(dataDir)) {
        entries.push({
          path: `data/${rel}`,
          data: fs.readFileSync(path.join(dataDir, rel)),
        });
      }
    }

    return entries;
  }

  return {
    /**
     * List existing backups, newest first.
     * Each entry: { id, filename, timestamp, sizeBytes, createdAt }.
     */
    list() {
      let names;
      try {
        names = fs.readdirSync(backupsDir);
      } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
      }

      const out = [];
      for (const name of names) {
        const parsed = parseFilename(name);
        if (!parsed) continue;

        const full = path.join(backupsDir, name);
        let stat;
        try { stat = fs.statSync(full); }
        catch { continue; }
        if (!stat.isFile()) continue;

        out.push({
          id: parsed.id,
          filename: name,
          timestamp: parsed.timestamp,
          sizeBytes: stat.size,
          createdAt: stat.mtime.toISOString(),
        });
      }
      out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)); // newest first
      return out;
    },

    /**
     * Create a new backup. Walks the data directory, packs everything,
     * encrypts, and writes atomically.
     *
     * Returns the metadata entry for the newly created backup.
     */
    create() {
      const entries = buildEntries();
      const blob = packBackup(entries, masterKey);
      const id = backupId(blob).slice(0, 8);
      const stamp = utcStamp();
      const filename = `${FILE_PREFIX}${stamp}-${id}${FILE_SUFFIX}`;
      const finalPath = path.join(backupsDir, filename);
      const tmpPath   = `${finalPath}.tmp`;

      fs.writeFileSync(tmpPath, blob, { mode: 0o600 });
      fs.renameSync(tmpPath, finalPath);

      const stat = fs.statSync(finalPath);
      return {
        id,
        filename,
        timestamp: stamp,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        entryCount: entries.length,
      };
    },

    /**
     * Read a backup file by id. Returns { filename, bytes } or null
     * if no backup with that id exists.
     */
    read(id) {
      if (!/^[0-9a-f]{8,16}$/.test(id)) return null;
      const all = this.list();
      const match = all.find((b) => b.id === id);
      if (!match) return null;
      const full = path.join(backupsDir, match.filename);
      return {
        filename: match.filename,
        bytes: fs.readFileSync(full),
      };
    },

    /**
     * Delete a backup file. Returns true if removed, false if no
     * backup with that id existed.
     */
    delete(id) {
      if (!/^[0-9a-f]{8,16}$/.test(id)) return false;
      const all = this.list();
      const match = all.find((b) => b.id === id);
      if (!match) return false;
      fs.unlinkSync(path.join(backupsDir, match.filename));
      return true;
    },

    /**
     * Apply retention: keep the newest `keep` backups, delete older
     * ones. Returns the list of deleted IDs.
     *
     * `keep` of 0 deletes everything; `keep` of Infinity (or any large
     * number) deletes nothing. Negative or NaN values are treated as 0.
     */
    pruneToKeep(keep) {
      const n = Number.isFinite(keep) && keep >= 0 ? Math.floor(keep) : 0;
      const all = this.list(); // newest-first
      const toDelete = all.slice(n); // everything past the keep window
      const deletedIds = [];
      for (const entry of toDelete) {
        try {
          fs.unlinkSync(path.join(backupsDir, entry.filename));
          deletedIds.push(entry.id);
        } catch {
          // Best-effort. A failed unlink leaves the file in place; the
          // next prune cycle will try again.
        }
      }
      return deletedIds;
    },

    /**
     * Restore from an encrypted backup blob.
     *
     * Steps (each step's failure is recoverable, no partial state):
     *   1. Decrypt + parse → entries[]. Throws on wrong key or corruption.
     *   2. Validate every path (data/* only, no traversal). Throws on bad path.
     *   3. Write entries to a staging directory.
     *   4. Atomically swap: data/ → data.pre-restore-<ts>/, staging → data/.
     *
     * Returns:
     *   { restoredEntries, dataFiles, configRestored, preRestorePath }
     *
     * `configRestored` is always false in Drop 2 (config.json is
     * intentionally skipped — see file header).
     *
     * After this call returns, in-memory stores STILL HAVE THE OLD
     * DATA. The caller is responsible for blocking subsequent
     * requests and instructing the user to restart Pica.
     */
    restore(blob) {
      // 1. Decrypt + parse
      const entries = unpackBackup(blob, masterKey);

      // 2. Validate every path
      const safe = [];
      for (const entry of entries) {
        const v = validateRestorePath(entry.path);
        if (!v.ok) {
          throw new Error(`refused to restore unsafe path: ${entry.path} (${v.reason})`);
        }
        if (v.skip) continue; // config.json — bundled but not restored in Drop 2
        safe.push({ relPath: v.relPath, data: entry.data });
      }

      // 3. Write to staging.
      const stamp = utcStamp();
      const stagingPath = `${dataDir}.staging-${stamp}`;
      fs.mkdirSync(stagingPath, { recursive: true, mode: 0o700 });
      try {
        for (const entry of safe) {
          const target = path.join(stagingPath, entry.relPath);
          fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
          fs.writeFileSync(target, entry.data, { mode: 0o600 });
        }
      } catch (err) {
        // Clean up staging on any write failure. Re-throw so the caller
        // knows the restore aborted.
        try { fs.rmSync(stagingPath, { recursive: true, force: true }); } catch { /* */ }
        throw err;
      }

      // 4. Atomic swap.
      const preRestorePath = `${dataDir}.pre-restore-${stamp}`;
      const dataExists = fs.existsSync(dataDir);
      try {
        if (dataExists) {
          fs.renameSync(dataDir, preRestorePath);
        }
        fs.renameSync(stagingPath, dataDir);
      } catch (err) {
        // Mid-swap failure. If we already moved data/ aside but the
        // second rename failed, try to undo. Best-effort.
        try {
          if (!fs.existsSync(dataDir) && fs.existsSync(preRestorePath)) {
            fs.renameSync(preRestorePath, dataDir);
          }
        } catch { /* */ }
        try { fs.rmSync(stagingPath, { recursive: true, force: true }); } catch { /* */ }
        throw err;
      }

      return {
        restoredEntries: safe.length,
        dataFiles: safe.length,
        configRestored: false,
        preRestorePath: dataExists ? preRestorePath : null,
      };
    },
  };
}

/**
 * Validate a path from a backup entry before writing it to the
 * filesystem. Returns one of:
 *   { ok: true, relPath: 'foo/bar.json' }   — restore this, under data/
 *   { ok: true, skip: true }                 — bundled but not restored
 *   { ok: false, reason: '...' }             — refuse the restore
 *
 * Rules:
 *   - 'config.json' is bundled but skipped in Drop 2
 *   - any path under 'data/' is restored, with the 'data/' prefix stripped
 *   - paths must be relative (no leading '/')
 *   - paths must not contain '..' segments or backslashes
 *   - paths must not be empty after the prefix is stripped
 */
function validateRestorePath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath === '') {
    return { ok: false, reason: 'empty path' };
  }
  if (rawPath.includes('\\')) {
    return { ok: false, reason: 'contains backslash' };
  }
  if (rawPath.startsWith('/')) {
    return { ok: false, reason: 'absolute path' };
  }
  // Reject any '..' segment, even legitimate-looking ones like 'foo/../bar'.
  const segments = rawPath.split('/');
  if (segments.some((s) => s === '..')) {
    return { ok: false, reason: 'parent-directory segment' };
  }

  if (rawPath === 'config.json') {
    return { ok: true, skip: true };
  }
  if (rawPath.startsWith('data/')) {
    const rel = rawPath.slice('data/'.length);
    if (rel === '') {
      return { ok: false, reason: 'empty path under data/' };
    }
    return { ok: true, relPath: rel };
  }

  return { ok: false, reason: 'path is not config.json and is not under data/' };
}
