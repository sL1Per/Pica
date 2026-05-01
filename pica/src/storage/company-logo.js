import fs from 'node:fs';
import path from 'node:path';

import { encryptBlob, decryptBlob } from '../crypto/aes.js';

/**
 * Company logo storage.
 *
 * One encrypted file at data/company-logo.bin. AAD = "company:logo" —
 * short and stable since there's only ever one logo per deployment.
 *
 * The on-disk format matches the employees picture store so the same
 * operational playbook applies (inspect, rotate keys, etc.).
 */

const LOGO_AAD = 'company:logo';
const FILENAME = 'company-logo.bin';

export function createCompanyLogoStore(dataDir, masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError('masterKey must be a 32-byte Buffer');
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(dataDir, FILENAME);

  return {
    /** Return decrypted bytes, or null if no logo uploaded. */
    read() {
      if (!fs.existsSync(filePath)) return null;
      const blob = fs.readFileSync(filePath);
      return decryptBlob(blob, masterKey, LOGO_AAD);
    },

    /**
     * Replace the logo. Accepts a Buffer of image bytes (client is
     * responsible for choosing a reasonable format/size; server caps
     * at the supplied max below).
     */
    write(bytes) {
      if (!Buffer.isBuffer(bytes)) throw new TypeError('bytes must be a Buffer');
      const ciphertext = encryptBlob(bytes, masterKey, LOGO_AAD);
      // Atomic: write to .tmp, then rename.
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, ciphertext, { mode: 0o600 });
      fs.renameSync(tmp, filePath);
    },

    /** Remove the logo if present. Idempotent. */
    remove() {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    },

    exists() {
      return fs.existsSync(filePath);
    },

    path: filePath,
  };
}
