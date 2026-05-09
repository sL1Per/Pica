#!/usr/bin/env node
/**
 * Validator helpers — unit tests.
 *
 * These tests are short but high-stakes: isUuid is the gate that
 * protects employees-storage path traversal. False negatives mean
 * legitimate IDs get rejected; false positives mean traversal is
 * possible.
 *
 * Run: node tests/test-validators.mjs
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { isUuid } from '../src/util/validators.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); failed++; }
}

console.log('isUuid');

test('accepts crypto.randomUUID() output', () => {
  for (let i = 0; i < 20; i++) {
    const id = randomUUID();
    assert.ok(isUuid(id), `should accept ${id}`);
  }
});

test('accepts well-formed v4 UUIDs (lowercase)', () => {
  assert.ok(isUuid('11111111-1111-4111-8111-111111111111'));
  assert.ok(isUuid('aaaaaaaa-aaaa-4aaa-bbbb-cccccccccccc'));
});

test('accepts uppercase UUIDs (case-insensitive)', () => {
  assert.ok(isUuid('11111111-1111-4111-8111-111111111111'.toUpperCase()));
});

test('rejects empty string', () => {
  assert.equal(isUuid(''), false);
});

test('rejects non-strings', () => {
  assert.equal(isUuid(undefined), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(42), false);
  assert.equal(isUuid({}), false);
  assert.equal(isUuid([]), false);
  assert.equal(isUuid(true), false);
});

// -- Path traversal characters ----------------------------------------------

test('rejects path traversal attempts (slashes)', () => {
  assert.equal(isUuid('../../etc/passwd'), false);
  assert.equal(isUuid('/etc/passwd'), false);
  assert.equal(isUuid('foo/bar'), false);
});

test('rejects path traversal with dots', () => {
  assert.equal(isUuid('..'), false);
  assert.equal(isUuid('../'), false);
  assert.equal(isUuid('foo..bar'), false);
});

test('rejects backslashes (Windows path separators)', () => {
  assert.equal(isUuid('..\\evil'), false);
  assert.equal(isUuid('foo\\bar'), false);
});

test('rejects URL-encoded traversal (after decoding)', () => {
  // Note: isUuid checks the post-decode string. The router calls
  // decodeURIComponent on params, so by the time isUuid runs the
  // %2F has already been decoded back to '/'.
  assert.equal(isUuid('..%2Fevil'), false);   // raw, not decoded
  assert.equal(isUuid('../evil'), false);     // post-decode
});

// -- Format edge cases ------------------------------------------------------

test('rejects all-zero UUID (not v4 — version nibble must be 4)', () => {
  // Pica only generates v4 UUIDs; an all-zero UUID would never collide
  // with a real one, but accepting it would expand the lookup space
  // for traversal-by-coincidence attacks (unlikely but free to block).
  assert.equal(isUuid('00000000-0000-0000-0000-000000000000'), false);
});

test('rejects v1 UUIDs (version nibble != 4)', () => {
  // v1 has timestamp + MAC, not what crypto.randomUUID() produces.
  assert.equal(isUuid('11111111-1111-1111-8111-111111111111'), false);
});

test('rejects UUIDs with bad variant nibble', () => {
  // Variant nibble (first hex of the 4th group) must be 8/9/a/b in v4.
  assert.equal(isUuid('11111111-1111-4111-1111-111111111111'), false);
  assert.equal(isUuid('11111111-1111-4111-7111-111111111111'), false);
  assert.equal(isUuid('11111111-1111-4111-c111-111111111111'), false);
});

test('rejects too-short / too-long strings', () => {
  assert.equal(isUuid('11111111-1111-4111-8111'), false);
  assert.equal(isUuid('11111111-1111-4111-8111-111111111111-extra'), false);
  assert.equal(isUuid('11111111-1111-4111-8111-1111111111111'), false); // one too many
});

test('rejects UUIDs with non-hex characters', () => {
  assert.equal(isUuid('zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz'), false);
  assert.equal(isUuid('11111111-1111-4111-8111-11111111111g'), false);
});

test('rejects whitespace-padded UUIDs', () => {
  assert.equal(isUuid(' 11111111-1111-4111-8111-111111111111'), false);
  assert.equal(isUuid('11111111-1111-4111-8111-111111111111 '), false);
  assert.equal(isUuid('11111111-1111-4111-8111-111111111111\n'), false);
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
