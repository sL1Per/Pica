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

    // Reject sessions issued before the user's last password change.
    // `passwordChangedAt` is only present on users who have ever
    // changed their password (or had one reset by an employer);
    // absence means "never changed" → no rejection.
    //
    // Comparison is in milliseconds (iat is ms since 0.19.0; pwChangedAt
    // is an ISO date string). Sessions without iat (issued by older
    // Pica builds) get iat=0 → any password change kills them.
    if (user.passwordChangedAt) {
      const pwChangedAtMs = Date.parse(user.passwordChangedAt);
      if (Number.isFinite(pwChangedAtMs) && session.iat < pwChangedAtMs) {
        return null; // session is older than the password change → invalidated
      }
    }

    return { session, user };
  }

  // Paths that remain accessible to a user with mustChangePassword=true.
  // Must include /api/me (so the frontend can detect the flag) and the
  // change-password endpoint itself; logout is also allowed because
  // expecting users to do a password change without being able to bail
  // out is too restrictive.
  const MUST_CHANGE_ALLOWLIST = new Set([
    '/api/me',
    '/api/me/password',
    '/api/logout',
  ]);

  function requireAuth(handler) {
    return async (req, res) => {
      const auth = authenticate(req);
      if (!auth) return res.unauthorized('Sign in required', { errorCode: 'unauthorized' });
      req.session = auth.session;
      req.user = auth.user;

      // If the user has been flagged to change their password, block
      // all API calls except the allowlist. Page loads route through
      // pages.js which has its own redirect for this state.
      if (auth.user.mustChangePassword && !MUST_CHANGE_ALLOWLIST.has(req.path)) {
        return res.forbidden(
          'You must change your password before continuing.',
          { errorCode: 'must_change_password' },
        );
      }

      return handler(req, res);
    };
  }

  function requireRole(role) {
    return (handler) => requireAuth(async (req, res) => {
      if (req.user.role !== role) return res.forbidden(`Requires role: ${role}`, { errorCode: 'forbidden' });
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
      return res.forbidden('Not your resource', { errorCode: 'forbidden' });
    });
  }

  return { requireAuth, requireRole, requireOwnerOrEmployer, authenticate };
}
