import { verifySession } from './sessions.js';

/**
 * RBAC middleware.
 *
 * Each factory returns a function that wraps a route handler. Wrappers
 * verify the session cookie, attach `req.user` (the full user record) and
 * `req.session` (the decoded payload), then either call through to the
 * handler or respond with 401 / 403.
 *
 * Usage:
 *   const { requireAuth, requireRole, requireOwnerOrEmployer } = createRBAC({ sessionKey, usersStore });
 *   router.get('/api/me', requireAuth((req, res) => res.json(req.user)));
 *   router.get('/api/employees', requireRole('employer')(listEmployees));
 *   router.get('/api/employees/:id', requireOwnerOrEmployer((req) => req.params.id)(showEmployee));
 */
export function createRBAC({ sessionKey, usersStore, cookieName = 'pica_session' }) {
  function authenticate(req) {
    const raw = req.cookies?.[cookieName];
    if (!raw) return null;
    const session = verifySession(raw, sessionKey);
    if (!session) return null;
    const user = usersStore.findById(session.uid);
    if (!user) return null; // user was deleted — session is stale
    return { session, user };
  }

  function requireAuth(handler) {
    return async (req, res) => {
      const auth = authenticate(req);
      if (!auth) return res.unauthorized('Sign in required');
      req.session = auth.session;
      req.user = auth.user;
      return handler(req, res);
    };
  }

  function requireRole(role) {
    return (handler) => requireAuth(async (req, res) => {
      if (req.user.role !== role) return res.forbidden(`Requires role: ${role}`);
      return handler(req, res);
    });
  }

  /**
   * Allow access if the authenticated user is either an employer OR the
   * owner of the target resource. `getOwnerId(req)` returns the user id
   * that owns the resource being accessed (e.g., the employee id in the URL).
   */
  function requireOwnerOrEmployer(getOwnerId) {
    return (handler) => requireAuth(async (req, res) => {
      const ownerId = getOwnerId(req);
      if (req.user.role === 'employer' || req.user.id === ownerId) {
        return handler(req, res);
      }
      return res.forbidden('Not your resource');
    });
  }

  return { requireAuth, requireRole, requireOwnerOrEmployer, authenticate };
}
