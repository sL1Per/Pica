import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.otf':   'font/otf',
};

export function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Try to serve `urlPath` as a static file under `rootDir`.
 * Returns true if the response was written, false if the file doesn't exist
 * (so the caller can fall back to 404).
 *
 * Directory requests map to index.html when present.
 * Path traversal (../) is blocked by comparing the resolved path to rootDir.
 *
 * `req` is optional — when provided, we honor If-None-Match for 304 revalidation.
 */
export async function serveStatic(urlPath, res, rootDir, req = null) {
  // Strip query string, decode percent-encoding.
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return false;
  }

  // Resolve the target path inside rootDir, guarding against traversal.
  const absRoot = path.resolve(rootDir);
  const absTarget = path.resolve(absRoot, '.' + decoded);
  if (!absTarget.startsWith(absRoot + path.sep) && absTarget !== absRoot) {
    return false;
  }

  let stat;
  try {
    stat = await fs.promises.stat(absTarget);
  } catch {
    return false;
  }

  let filePath = absTarget;
  if (stat.isDirectory()) {
    filePath = path.join(absTarget, 'index.html');
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return false;
    }
  }
  if (!stat.isFile()) return false;

  // Weak ETag from mtime + size — cheap and stable.
  const etag = `W/"${stat.size}-${stat.mtimeMs.toFixed(0)}"`;

  // Honor conditional requests so repeat fetches don't pay for a full response.
  if (req && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return true;
  }

  res.writeHead(200, {
    'Content-Type': mimeFor(filePath),
    'Content-Length': stat.size,
    // Force revalidation on every request. For a small self-hosted tool,
    // correctness beats the savings from long-lived caches — otherwise a
    // stale JS file will outlive the fix that was supposed to replace it.
    'Cache-Control': 'no-store, must-revalidate',
    ETag: etag,
  });

  // Stream the file to avoid loading large assets into memory.
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });

  return true;
}
