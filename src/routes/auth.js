import { signSession, SESSION_TTL_SECONDS } from '../auth/sessions.js';
import { verifyPassword } from '../crypto/passwords.js';
import { serializeCookie } from '../http/cookies.js';

/**
 * Routes for login, logout, and current-user lookup.
 *
 * Login failures always return a generic message — never reveal whether
 * the username or the password was the wrong part. Rate limiting uses the
 * client IP from the socket; if you front the server with a reverse proxy
 * you'll want to revisit this (X-Forwarded-For) in a future milestone.
 */
export function registerAuthRoutes(router, { usersStore, sessionKey, loginLimiter, requireAuth, cookieName = 'pica_session', isProduction = false }) {

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
      return res.json({ error: 'Too many login attempts. Try again in a minute.' }, 429);
    }

    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.badRequest('Username and password are required');
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
      return res.json({ error: 'Invalid username or password' }, 401);
    }

    // Successful login — reset the limiter for this IP.
    loginLimiter.reset(ip);

    const cookie = signSession({ uid: user.id, role: user.role }, sessionKey);
    setSessionCookie(res, cookie, SESSION_TTL_SECONDS);

    res.json({
      ok: true,
      user: { id: user.id, username: user.username, role: user.role },
    });
  });

  // --------------------------------------------------------------------------
  router.post('/api/logout', async (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // --------------------------------------------------------------------------
  router.get('/api/me', requireAuth((req, res) => {
    res.json({
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
    });
  }));
}
