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

export function notFound(res, message = 'Not Found') {
  json(res, { error: message }, 404);
}

export function forbidden(res, message = 'Forbidden') {
  json(res, { error: message }, 403);
}

export function unauthorized(res, message = 'Unauthorized') {
  json(res, { error: message }, 401);
}

export function badRequest(res, message = 'Bad Request') {
  json(res, { error: message }, 400);
}

export function serverError(res, message = 'Internal Server Error') {
  json(res, { error: message }, 500);
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
  res.notFound     = (m)                  => notFound(res, m);
  res.forbidden    = (m)                  => forbidden(res, m);
  res.unauthorized = (m)                  => unauthorized(res, m);
  res.badRequest   = (m)                  => badRequest(res, m);
  res.serverError  = (m)                  => serverError(res, m);
  return res;
}
