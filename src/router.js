/**
 * A tiny router. Handlers are registered per method + path pattern and
 * matched in registration order. Patterns support `:name` segments:
 *
 *   router.get('/employees/:id', handler);
 *   → matches /employees/42, exposes { id: '42' } on req.params
 *
 * Match results are { handler, params } for use by the server entry point.
 * If the path matches any route but not for the requested method, the router
 * reports `methodNotAllowed` so the caller can return 405 instead of 404.
 */

function compile(pattern) {
  const keys = [];
  const escaped = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { regex: new RegExp(`^${escaped}/?$`), keys };
}

export function createRouter() {
  /** @type {Array<{method: string, compiled: {regex: RegExp, keys: string[]}, handler: Function}>} */
  const routes = [];

  function register(method, pattern, handler) {
    routes.push({ method, compiled: compile(pattern), handler });
  }

  return {
    get:    (p, h) => register('GET',    p, h),
    post:   (p, h) => register('POST',   p, h),
    put:    (p, h) => register('PUT',    p, h),
    patch:  (p, h) => register('PATCH',  p, h),
    delete: (p, h) => register('DELETE', p, h),

    /**
     * Find a matching route.
     * Returns:
     *   { handler, params }             — found a method-and-path match
     *   { methodNotAllowed: true }      — path matched but method didn't
     *   null                            — no route matches this path at all
     */
    match(method, pathname) {
      let pathMatched = false;
      for (const route of routes) {
        const m = route.compiled.regex.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (route.method !== method) continue;
        const params = {};
        route.compiled.keys.forEach((key, i) => {
          params[key] = decodeURIComponent(m[i + 1]);
        });
        return { handler: route.handler, params };
      }
      if (pathMatched) return { methodNotAllowed: true };
      return null;
    },
  };
}
