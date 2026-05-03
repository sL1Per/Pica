import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { hashPassword } from '../crypto/passwords.js';

/**
 * Users store. Backed by data/users.json.
 *
 * Plaintext (per README security table): password hashes are already
 * one-way, and the server needs to read this file before the master key
 * is in play for anything else.
 *
 * In-memory cache avoids re-reading the file on every request; writes
 * go through saveAll() which refreshes the cache atomically.
 */

const VALID_ROLES = new Set(['employer', 'employee']);
const USERNAME_RE = /^[A-Za-z0-9._@-]{2,64}$/;

function atomicWrite(filePath, contents) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, contents, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export function createUsersStore(dataDir) {
  const filePath = path.join(dataDir, 'users.json');
  let cache = null;

  function loadAll() {
    if (cache) return cache;
    if (!fs.existsSync(filePath)) {
      cache = { users: [] };
      return cache;
    }
    try {
      cache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(cache.users)) cache.users = [];
    } catch (err) {
      throw new Error(`Failed to parse ${filePath}: ${err.message}`);
    }
    return cache;
  }

  function saveAll(data) {
    fs.mkdirSync(dataDir, { recursive: true });
    atomicWrite(filePath, JSON.stringify(data, null, 2) + '\n');
    cache = data;
  }

  return {
    /** Returns the number of users currently in the store. */
    count() {
      return loadAll().users.length;
    },

    /** True if at least one user exists. */
    hasAny() {
      return this.count() > 0;
    },

    /** Find a user by id, or null. */
    findById(id) {
      return loadAll().users.find((u) => u.id === id) ?? null;
    },

    /** Find a user by username (case-insensitive), or null. */
    findByUsername(username) {
      if (!username) return null;
      const lower = username.toLowerCase();
      return loadAll().users.find((u) => u.username.toLowerCase() === lower) ?? null;
    },

    /** List all users (returns a shallow copy). */
    list() {
      return [...loadAll().users];
    },

    /**
     * Create a new user. Throws on duplicate username or invalid input.
     * Returns the created user record (without the password hash).
     */
    async create({ username, password, role }) {
      if (!USERNAME_RE.test(username ?? '')) {
        const e = new Error('Invalid username — use 2–64 chars: letters, digits, and . _ - @');
        e.code = 'invalid_value';
        throw e;
      }
      if (typeof password !== 'string' || password.length < 8) {
        const e = new Error('Password must be at least 8 characters');
        e.code = 'password_too_short';
        throw e;
      }
      if (!VALID_ROLES.has(role)) {
        const e = new Error(`Invalid role: ${role}`);
        e.code = 'invalid_value';
        throw e;
      }
      if (this.findByUsername(username)) {
        const e = new Error('Username already exists');
        e.code = 'username_taken';
        throw e;
      }

      const data = loadAll();
      const passwordHash = await hashPassword(password);
      const user = {
        id: randomUUID(),
        username,
        passwordHash,
        role,
        createdAt: new Date().toISOString(),
      };
      saveAll({ users: [...data.users, user] });

      const { passwordHash: _omit, ...safe } = user;
      return safe;
    },

    /**
     * Delete a user by id. Returns true if the user was removed, false
     * if no such user existed.
     */
    deleteById(id) {
      const data = loadAll();
      const before = data.users.length;
      const users = data.users.filter((u) => u.id !== id);
      if (users.length === before) return false;
      saveAll({ users });
      return true;
    },

    /** Drop the in-memory cache — used in tests. */
    invalidate() {
      cache = null;
    },

    /** Expose the path for diagnostics / tests. */
    path: filePath,
  };
}
