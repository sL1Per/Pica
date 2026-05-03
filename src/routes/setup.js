import { signSession, SESSION_TTL_SECONDS } from '../auth/sessions.js';
import { serializeCookie } from '../http/cookies.js';

/**
 * First-run setup endpoint.
 *
 * Creates the first employer account. Only accepts requests while the
 * users store is empty — once anyone exists, this route always returns
 * 403. This avoids the obvious privilege-escalation trap ("visit /setup
 * to make yourself an admin").
 */
export function registerSetupRoutes(router, { usersStore, sessionKey, cookieName = 'pica_session', isProduction = false }) {
  router.post('/api/setup', async (req, res) => {
    if (usersStore.hasAny()) {
      return res.forbidden('Setup has already been completed', { errorCode: 'setup_already_done' });
    }

    const { username, password } = req.body ?? {};
    let user;
    try {
      user = await usersStore.create({ username, password, role: 'employer' });
    } catch (err) {
      return res.badRequest(err.message, { errorCode: err.code || 'invalid_value' });
    }

    const cookie = signSession({ uid: user.id, role: user.role }, sessionKey);
    res.setHeader('Set-Cookie', serializeCookie(cookieName, cookie, {
      maxAge: SESSION_TTL_SECONDS,
      httpOnly: true,
      sameSite: 'Lax',
      secure: isProduction,
      path: '/',
    }));

    res.json({ ok: true, user });
  });
}
