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

import { isUuid, sniffImageType } from '../src/util/validators.js';

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

// -- sniffImageType (M16 F15) -----------------------------------------------

console.log('\nsniffImageType');

test('detects PNG (full 8-byte signature)', () => {
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
});

test('detects PNG from the 4-byte prefix alone', () => {
  // The upload routes only need the leading signature; 4 bytes identify PNG.
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'png');
});

test('detects JPEG (FF D8 FF)', () => {
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])), 'jpeg');
});

test('detects GIF ("GIF8")', () => {
  assert.equal(sniffImageType(Buffer.from('GIF89a', 'latin1')), 'gif');
});

test('detects WebP (RIFF....WEBP)', () => {
  const webp = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'latin1')]);
  assert.equal(sniffImageType(webp), 'webp');
});

test('rejects non-image bytes', () => {
  assert.equal(sniffImageType(Buffer.from('not an image at all', 'utf8')), null);
  assert.equal(sniffImageType(Buffer.from('<svg xmlns=', 'utf8')), null); // SVG is not allowed
  assert.equal(sniffImageType(Buffer.from('%PDF-1.4', 'utf8')), null);
});

test('rejects non-buffers and too-short input', () => {
  assert.equal(sniffImageType(null), null);
  assert.equal(sniffImageType('PNG'), null);
  assert.equal(sniffImageType(Buffer.from([0x89, 0x50])), null); // < 4 bytes
  // RIFF without the WEBP tag (e.g. a WAV) is not a WebP.
  const wav = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVE', 'latin1')]);
  assert.equal(sniffImageType(wav), null);
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
