/**
 * Buffer and parse request bodies.
 *
 * Supported content types:
 *   - application/json                  → object
 *   - application/x-www-form-urlencoded → object of string fields
 *   - multipart/form-data               → { fields: {...}, files: [{ field, filename, contentType, data }] }
 *   - anything else / empty             → {}
 *
 * Bodies larger than maxBytes are rejected with a 413-style error.
 * The entire body is held in memory; streaming is a future optimization.
 */

export class BodyTooLargeError extends Error {
  constructor(limit) {
    super(`Request body exceeds ${limit} bytes`);
    this.code = 'BODY_TOO_LARGE';
  }
}

export class BadBodyError extends Error {
  constructor(message) {
    super(message);
    this.code = 'BAD_BODY';
  }
}

/**
 * Read the raw request body into a Buffer, enforcing a size cap.
 */
export function readRawBody(req, { maxBytes }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new BodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Parse the request body according to its Content-Type header.
 * Returns an object (for JSON/urlencoded) or a { fields, files } shape (for multipart).
 */
export async function parseBody(req, { maxBytes }) {
  const rawContentType = req.headers['content-type'] || '';
  const contentType = rawContentType.toLowerCase(); // case-insensitive for the *type*, not the boundary
  if (!contentType) return {};

  const raw = await readRawBody(req, { maxBytes });
  if (raw.length === 0) return {};

  if (contentType.startsWith('application/json')) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch (err) {
      throw new BadBodyError(`Invalid JSON: ${err.message}`);
    }
  }

  if (contentType.startsWith('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  }

  if (contentType.startsWith('multipart/form-data')) {
    // Use the original-case header — boundary values are case-sensitive.
    const boundary = extractBoundary(rawContentType);
    if (!boundary) throw new BadBodyError('multipart/form-data missing boundary');
    return parseMultipart(raw, boundary);
  }

  // Unknown content type — don't guess. Expose the raw buffer for niche cases.
  return { _raw: raw };
}

// ----------------------------------------------------------------------------
// multipart/form-data parsing
// ----------------------------------------------------------------------------

function extractBoundary(contentType) {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return null;
  return (match[1] ?? match[2]).trim();
}

/**
 * Parse a buffered multipart body. Binary-safe — all operations use Buffer.
 *
 * Structure of a multipart body:
 *   [preamble] --BOUNDARY\r\n headers\r\n\r\n body \r\n
 *              --BOUNDARY\r\n headers\r\n\r\n body \r\n
 *              --BOUNDARY--\r\n [epilogue]
 *
 * Strategy:
 *   1. Prepend "\r\n" so the very first boundary has the same prefix
 *      ("\r\n--BOUNDARY") as every subsequent one.
 *   2. Collect all delimiter positions in one pass.
 *   3. Each adjacent pair of positions brackets one part; stop once a
 *      delimiter is immediately followed by "--" (the terminator).
 */
function parseMultipart(buf, boundary) {
  const result = { fields: {}, files: [] };
  const fullDelim = Buffer.from(`\r\n--${boundary}`);
  const headerSep = Buffer.from('\r\n\r\n');

  // Prepend CRLF so the first delimiter looks like every other.
  const b = Buffer.concat([Buffer.from('\r\n'), buf]);

  const positions = [];
  let i = 0;
  while (true) {
    const found = b.indexOf(fullDelim, i);
    if (found < 0) break;
    positions.push(found);
    i = found + fullDelim.length;
  }

  for (let j = 0; j < positions.length - 1; j++) {
    const afterDelim = positions[j] + fullDelim.length;

    // "--" right after the delim = terminator; nothing past it is a real part.
    if (b[afterDelim] === 0x2d && b[afterDelim + 1] === 0x2d) break;

    // Skip the "\r\n" that follows a non-terminal delimiter.
    let partStart = afterDelim;
    if (b[partStart] === 0x0d && b[partStart + 1] === 0x0a) partStart += 2;

    const partEnd = positions[j + 1];
    const part = b.subarray(partStart, partEnd);

    const headerEnd = part.indexOf(headerSep);
    if (headerEnd < 0) continue;

    const headers = parseHeaders(part.subarray(0, headerEnd).toString('latin1'));
    const body = part.subarray(headerEnd + headerSep.length);
    absorbPart(result, headers, body);
  }

  return result;
}

function parseHeaders(str) {
  const headers = {};
  for (const line of str.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[name] = value;
  }
  return headers;
}

function absorbPart(result, headers, body) {
  const cd = headers['content-disposition'];
  if (!cd) return;

  const name = matchQuoted(cd, 'name');
  if (!name) return;

  const filename = matchQuoted(cd, 'filename');
  if (filename !== null) {
    result.files.push({
      field: name,
      filename,
      contentType: headers['content-type'] || 'application/octet-stream',
      data: Buffer.from(body), // copy out of the big buffer
    });
  } else {
    result.fields[name] = body.toString('utf8');
  }
}

function matchQuoted(str, key) {
  const re = new RegExp(`${key}="([^"]*)"`, 'i');
  const m = str.match(re);
  return m ? m[1] : null;
}
