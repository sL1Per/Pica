import { signSession, verifySession, SESSION_TTL_SECONDS } from '../auth/sessions.js';
import { verifyPassword } from '../crypto/passwords.js';
import { serializeCookie } from '../http/cookies.js';
import { auditContext } from '../storage/audit.js';

/**
 * Routes for login, logout, and current-user lookup.
 *
 * Login failures always return a generic message — never reveal whether
 * the username or the password was the wrong part. Rate limiting uses the
 * client IP from the socket; if you front the server with a reverse proxy
 * you'll want to revisit this (X-Forwarded-For) in a future milestone.
 */
export function registerAuthRoutes(router, {
  usersStore,
  employeesStore,
  sessionKey,
  loginLimiter,
  passwordLimiter,
  requireAuth,
  cookieName = 'pica_session',
  isProduction = false,
  auditStore = null,
}) {

  function clientIp(req) {
    return req.socket?.remoteAddress ?? 'unknown';
  }

  function setSessionCookie(res, value, maxAgeSec) {
    res.setHeader('Set-Cookie', serializeCookie(cookieName, value, {
      maxAge: maxAgeSec,
      httpOnly: true,
      sameSite: 'Lax',
      secure: isProduction,
      path: '/',
    }));
  }

  function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', serializeCookie(cookieName, '', {
      maxAge: 0,
      httpOnly: true,
      sameSite: 'Lax',
      secure: isProduction,
      path: '/',
    }));
  }

  // --------------------------------------------------------------------------
  router.post('/api/login', async (req, res) => {
    const ip = clientIp(req);
    if (!loginLimiter.allow(ip)) {
      // Note: not auditing rate-limit hits — they would be high-volume
      // and don't add much over the regular logger's INFO traces.
      return res.json({ error: 'Too many login attempts. Try again in a minute.', errorCode: 'rate_limited' }, 429);
    }

    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.badRequest('Username and password are required', { errorCode: 'required' });
    }

    const user = usersStore.findByUsername(username);
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;

    // Perform a fake verify when the user doesn't exist, so the response
    // time doesn't leak whether the username was valid. (Best-effort —
    // scrypt timings vary naturally anyway.)
    if (!user) {
      await verifyPassword(password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    }

    if (!ok) {
      auditStore?.appendRecord({
        event: 'auth.login_failure',
        actorId: null,
        actorUsername: null,
        actorRole: null,
        actorIp: ip,
        // The username is recorded as a target so investigators can spot
        // patterns ("100 failed logins for `admin`"). NOT stored as
        // actorUsername because the actor was never authenticated.
        target: { username },
        outcome: 'failure',
      });
      return res.json({ error: 'Invalid username or password', errorCode: 'invalid_credentials' }, 401);
    }

    if (user.active === false) {
      auditStore?.appendRecord({
        event: 'auth.login_failure',
        actorId: null, actorUsername: null, actorRole: null, actorIp: ip,
        target: { username }, outcome: 'failure',
        details: { deactivated: true },
      });
      return res.json({ error: 'This account has been deactivated.', errorCode: 'account_deactivated' }, 403);
    }

    // Successful login — reset the limiter for this IP.
    loginLimiter.reset(ip);

    const cookie = signSession({ uid: user.id, role: user.role }, sessionKey);
    setSessionCookie(res, cookie, SESSION_TTL_SECONDS);

    auditStore?.appendRecord({
      event: 'auth.login_success',
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      actorIp: ip,
      details: user.mustChangePassword ? { mustChangePassword: true } : null,
    });

    res.json({
      ok: true,
      user: { id: user.id, username: user.username, role: user.role },
      mustChangePassword: !!user.mustChangePassword,
    });
  });

  // --------------------------------------------------------------------------
  router.post('/api/logout', async (req, res) => {
    // Logout is reachable even with a stale/missing session, so we
    // can't rely on req.user. Best-effort: peek at the cookie ourselves.
    const ip = clientIp(req);
    const raw = req.cookies?.[cookieName];
    const session = raw ? verifySession(raw, sessionKey) : null;
    const user = session ? usersStore.findById(session.uid) : null;
    auditStore?.appendRecord({
      event: 'auth.logout',
      actorId: user?.id ?? null,
      actorUsername: user?.username ?? null,
      actorRole: user?.role ?? null,
      actorIp: ip,
    });
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // --------------------------------------------------------------------------
  router.get('/api/me', requireAuth((req, res) => {
    // fullName lives in the encrypted employee profile, not the users store.
    // Look it up; null when the profile doesn't exist (e.g. employer with no
    // profile row yet, or when the employee profile was deleted).
    let fullName = null;
    if (employeesStore) {
      try {
        const profile = employeesStore.readProfile(req.user.id);
        fullName = profile?.fullName ?? null;
      } catch { /* fall through with null */ }
    }
    // Re-read the full record to surface mustChangePassword. The session
    // cookie carries id+role only; this flag has to come from the store.
    const fullUser = usersStore.findById(req.user.id);
    res.json({
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      fullName,
      mustChangePassword: !!fullUser?.mustChangePassword,
    });
  }));

  // --------------------------------------------------------------------------
  // Self-service password change. Requires the current password (or the
  // employer-supplied temporary password if mustChangePassword is set).
  // Rate-limited per user-id to slow brute-force on the current password.
  router.post('/api/me/password', requireAuth(async (req, res) => {
    if (passwordLimiter && !passwordLimiter.allow(req.user.id)) {
      return res.json(
        { error: 'Too many password change attempts. Try again later.', errorCode: 'rate_limited' },
        429,
      );
    }

    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.badRequest(
        'currentPassword and newPassword are required',
        { errorCode: 'required' },
      );
    }

    try {
      await usersStore.verifyAndSetPassword(req.user.id, currentPassword, newPassword);
    } catch (err) {
      // Map storage errors to errorCodes the frontend can localize.
      const errorCode = err.code || 'invalid_value';
      // 401 for wrong current password (auth failure semantics).
      // 400 for everything else.
      const status = errorCode === 'invalid_credentials' ? 401 : 400;
      // Only audit the wrong-password case (more interesting than e.g.
      // password_too_short, which is a UI-correctable user error).
      if (errorCode === 'invalid_credentials') {
        auditStore?.appendRecord({
          ...auditContext(req),
          event: 'password.self_change',
          outcome: 'failure',
          details: { reason: errorCode },
        });
      }
      return res.json({ error: err.message, errorCode }, status);
    }

    // Reissue the session cookie. The auth middleware rejects sessions
    // whose iat is older than passwordChangedAt — without a fresh
    // cookie, the very next request would log the user out.
    // Other sessions (different devices) are correctly invalidated by
    // this same check; this one survives because its iat is current.
    const fresh = signSession({ uid: req.user.id, role: req.user.role }, sessionKey);
    setSessionCookie(res, fresh, SESSION_TTL_SECONDS);

    auditStore?.appendRecord({
      ...auditContext(req),
      event: 'password.self_change',
      outcome: 'success',
    });

    res.json({ ok: true });
  }));
}
