import fs from 'node:fs';
import path from 'node:path';

import { encryptBlob, decryptBlob } from '../crypto/aes.js';

/**
 * Employee storage.
 *
 * File layout:
 *   data/employees/<id>.json       — AES-GCM ciphertext of the profile JSON
 *   data/employees/<id>.picture    — AES-GCM ciphertext of JPEG bytes (optional)
 *
 * The .json extension is a lie (the file is binary), but matches what the
 * README architecture diagram documents.
 *
 * AAD = "employee:<id>" binds each ciphertext to its record. An attacker
 * with file access can't swap Alice's encrypted profile for Bob's.
 */

// Fields an employee may edit on themselves.
export const EMPLOYEE_EDITABLE = Object.freeze([
  'fullName', 'dateOfBirth', 'address', 'contactEmail', 'contactPhone',
]);

// Fields only an employer may edit.
export const EMPLOYER_ONLY = Object.freeze(['position', 'comments']);

// Everything an employer can touch.
export const ALL_EDITABLE = Object.freeze([...EMPLOYEE_EDITABLE, ...EMPLOYER_ONLY]);

function aadFor(id) {
  return `employee:${id}`;
}

function atomicWrite(filePath, buffer) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, buffer, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export function createEmployeesStore(dataDir, masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError('masterKey must be a 32-byte Buffer');
  }
  const empDir = path.join(dataDir, 'employees');
  fs.mkdirSync(empDir, { recursive: true });

  function profilePath(id) { return path.join(empDir, `${id}.json`); }
  function picturePath(id) { return path.join(empDir, `${id}.picture`); }

  // --------------------------------------------------------------------------

  function exists(id) {
    return fs.existsSync(profilePath(id));
  }

  function readProfile(id) {
    if (!exists(id)) return null;
    const blob = fs.readFileSync(profilePath(id));
    const plain = decryptBlob(blob, masterKey, aadFor(id));
    const data = JSON.parse(plain.toString('utf8'));
    return { id, ...data };
  }

  function writeProfile(id, profile) {
    // Never persist id/timestamps inside the ciphertext: id is the filename,
    // timestamps are updated on each write, so it's cleaner to keep them
    // out of the inner object. Actually — we keep updatedAt/createdAt INSIDE
    // the encrypted blob to avoid separate metadata files. `id` stays out.
    const { id: _drop, ...inner } = profile;
    const plain = Buffer.from(JSON.stringify(inner), 'utf8');
    const blob = encryptBlob(plain, masterKey, aadFor(id));
    atomicWrite(profilePath(id), blob);
  }

  function remove(id) {
    try { fs.unlinkSync(profilePath(id)); } catch {}
    try { fs.unlinkSync(picturePath(id)); } catch {}
  }

  // --------------------------------------------------------------------------

  function hasPicture(id) {
    return fs.existsSync(picturePath(id));
  }

  function writePicture(id, bytes) {
    if (!Buffer.isBuffer(bytes)) throw new TypeError('picture must be a Buffer');
    const blob = encryptBlob(bytes, masterKey, aadFor(id));
    atomicWrite(picturePath(id), blob);
  }

  function readPicture(id) {
    if (!hasPicture(id)) return null;
    const blob = fs.readFileSync(picturePath(id));
    return decryptBlob(blob, masterKey, aadFor(id));
  }

  function deletePicture(id) {
    try { fs.unlinkSync(picturePath(id)); } catch {}
  }

  // --------------------------------------------------------------------------

  /**
   * Create a new profile for an existing user id. Sets createdAt/updatedAt.
   * Filters fields against the allowed list.
   */
  function create(id, fields) {
    if (exists(id)) throw new Error('Profile already exists');
    const now = new Date().toISOString();
    const cleaned = pickFields(fields, ALL_EDITABLE);
    writeProfile(id, { ...cleaned, createdAt: now, updatedAt: now });
    return readProfile(id);
  }

  /**
   * Merge the given fields into an existing profile (or create on first call).
   * `allowed` controls which keys can be written — employers pass ALL_EDITABLE,
   * employees pass EMPLOYEE_EDITABLE.
   */
  function update(id, changes, allowed = ALL_EDITABLE) {
    const cleaned = pickFields(changes, allowed);
    const current = readProfile(id);
    const now = new Date().toISOString();
    const merged = {
      ...(current ?? { createdAt: now }),
      ...cleaned,
      updatedAt: now,
    };
    // Strip the id that readProfile adds back, since writeProfile strips it again.
    delete merged.id;
    writeProfile(id, merged);
    return readProfile(id);
  }

  /**
   * List all profiles on disk. Returns minimal summary records — useful for
   * the list view. Decrypts every file (fine for small teams).
   */
  function list() {
    const names = fs.readdirSync(empDir).filter((n) => n.endsWith('.json'));
    const out = [];
    for (const name of names) {
      const id = name.slice(0, -5); // strip ".json"
      try {
        const p = readProfile(id);
        if (p) out.push({
          id: p.id,
          fullName: p.fullName ?? null,
          position: p.position ?? null,
          hasPicture: hasPicture(id),
          updatedAt: p.updatedAt ?? null,
        });
      } catch {
        // Skip unreadable / corrupt files rather than failing the list.
      }
    }
    return out;
  }

  // --------------------------------------------------------------------------

  return {
    exists,
    readProfile,
    create,
    update,
    remove,
    hasPicture,
    writePicture,
    readPicture,
    deletePicture,
    list,
    // Exposed for diagnostics / tests:
    paths: { profilePath, picturePath, dir: empDir },
  };
}

function pickFields(src, allowed) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const key of allowed) {
    if (key in src) out[key] = src[key];
  }
  return out;
}
