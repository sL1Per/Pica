/**
 * Response helpers. Each helper writes a complete response and ends it.
 * Callers that need fine-grained control can bypass these and use res directly.
 */

export function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function html(res, body, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function text(res, body, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location });
  res.end();
}

export function noContent(res) {
  res.writeHead(204);
  res.end();
}

/**
 * Build an error body that always includes `error` (English fallback message)
 * and optionally `errorCode` (machine-readable code for the i18n layer to
 * translate). Helpers below accept an `opts` object: `{ errorCode: '...' }`.
 *
 * The frontend's `translateError(code, fallback)` looks up `errors.<code>`
 * in the dictionary and falls back to the `error` field when the code is
 * absent or unknown. So `errorCode` is purely additive.
 */
function errorBody(message, opts) {
  const body = { error: message };
  if (opts && typeof opts.errorCode === 'string') {
    body.errorCode = opts.errorCode;
  }
  return body;
}

export function notFound(res, message = 'Not Found', opts) {
  json(res, errorBody(message, opts), 404);
}

export function forbidden(res, message = 'Forbidden', opts) {
  json(res, errorBody(message, opts), 403);
}

export function unauthorized(res, message = 'Unauthorized', opts) {
  json(res, errorBody(message, opts), 401);
}

export function badRequest(res, message = 'Bad Request', opts) {
  json(res, errorBody(message, opts), 400);
}

export function serverError(res, message = 'Internal Server Error', opts) {
  json(res, errorBody(message, opts), 500);
}

export function serviceUnavailable(res, message = 'Service Unavailable', opts) {
  json(res, errorBody(message, opts), 503);
}

/**
 * Attach the helpers directly to a Node ServerResponse for Express-style ergonomics.
 * Called once per request by the server entry point.
 */
export function enhance(res) {
  res.json         = (data, status)       => json(res, data, status);
  res.html         = (body, status)       => html(res, body, status);
  res.text         = (body, status)       => text(res, body, status);
  res.redirect     = (loc, status)        => redirect(res, loc, status);
  res.noContent    = ()                   => noContent(res);
  res.notFound     = (m, opts)            => notFound(res, m, opts);
  res.forbidden    = (m, opts)            => forbidden(res, m, opts);
  res.unauthorized = (m, opts)            => unauthorized(res, m, opts);
  res.badRequest   = (m, opts)            => badRequest(res, m, opts);
  res.serverError  = (m, opts)            => serverError(res, m, opts);
  res.serviceUnavailable = (m, opts)      => serviceUnavailable(res, m, opts);
  return res;
}
