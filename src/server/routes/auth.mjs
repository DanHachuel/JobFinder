/**
 * JobFinder — local auth routes (mounted at /api/auth, BEFORE the guard).
 *
 *   POST /api/auth/login      { email, password } -> sets the session cookie
 *   POST /api/auth/logout     clears the cookie and revokes the token
 *   GET  /api/auth/session    { authenticated, user }
 *   PUT  /api/auth/password   { currentPassword, newPassword, confirmPassword }
 *   GET  /api/auth/defaults   first-run hint (default e-mail + flag)
 *
 * Single local user stored in ~/.jobfinder/auth.json (password hashed with
 * scrypt — see storage/authStore.mjs).
 */
import { Router } from 'express';

import { asyncRoute, badRequest } from '../middleware/errors.mjs';
import { requireSession } from '../middleware/auth.mjs';
import {
  AuthStore,
  DEFAULT_EMAIL,
  SESSION_TTL_MS,
  extractToken,
  sessionCookieOptions,
} from '../storage/authStore.mjs';

export function authRoutes({ store, logger }) {
  const router = Router();
  const auth = new AuthStore(store);

  router.post(
    '/login',
    asyncRoute(async (req, res) => {
      const { email, password } = req.body ?? {};
      if (!email || !password) {
        throw badRequest('Informe e-mail e senha.');
      }
      const user = auth.verifyCredentials(email, password);
      if (!user) {
        logger.warn('auth', 'login failed', { email: String(email).toLowerCase() });
        throw unauthorized('E-mail ou senha inválidos.');
      }
      const token = auth.issueToken(user.email);
      res.cookie('jobfinder_session', token, sessionCookieOptions());
      logger.info('auth', 'login ok', { email: user.email });
      res.json({
        user,
        session: { expiresInDays: Math.round(SESSION_TTL_MS / 86_400_000), defaultPasswordInUse: auth.usingDefaultPassword() },
      });
    })
  );

  router.post(
    '/logout',
    asyncRoute((req, res) => {
      const token = extractToken(req);
      if (token) auth.revokeToken(token);
      res.clearCookie('jobfinder_session', sessionCookieOptions({ maxAge: undefined }));
      logger.info('auth', 'logout', { email: req.user?.email ?? null });
      res.json({ ok: true });
    })
  );

  router.get(
    '/session',
    asyncRoute((req, res) => {
      const payload = auth.verifyToken(extractToken(req));
      if (!payload) {
        return res.json({ authenticated: false, user: null });
      }
      res.json({
        authenticated: true,
        user: auth.getUser(),
        defaultPasswordInUse: auth.usingDefaultPassword(),
      });
    })
  );

  router.put(
    '/password',
    requireSession({ store }),
    asyncRoute(async (req, res) => {
      const { currentPassword, newPassword, confirmPassword } = req.body ?? {};
      if (!currentPassword || !newPassword) {
        throw badRequest('Informe a senha atual e a nova senha.');
      }
      const user = auth.changePassword({ currentPassword, newPassword, confirmPassword });
      logger.info('auth', 'password changed', { email: user.email });
      res.json({ user, message: 'Senha alterada. Use a nova senha no próximo login.' });
    })
  );

  router.get(
    '/defaults',
    asyncRoute((req, res) => {
      res.json({ email: DEFAULT_EMAIL, firstRun: auth.usingDefaultPassword() });
    })
  );

  return router;
}

function unauthorized(message) {
  const err = new Error(message);
  err.status = 401;
  err.code = 'invalid_credentials';
  err.expose = true;
  return err;
}
