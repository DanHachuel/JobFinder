/**
 * JobFinder — auth guard.
 *
 * Every /api route (and therefore every UI screen) requires an active
 * local session. Exceptions:
 *   /api/auth/*                     login / logout / session check
 *   /api/health                     public liveness (used by the CI smoke test)
 *   /api/channels/oauth/callback    LinkedIn redirects the browser here
 *
 * The session token travels in an HTTP-only cookie (browser) or as a
 * Bearer token (curl/API tests).
 */
import { AuthStore, extractToken } from '../storage/authStore.mjs';

/** API paths reachable without a session. */
const PUBLIC_PATHS = ['/health', '/channels/oauth/callback'];

function isPublic(req) {
  const candidates = [req.path, req.originalUrl?.split('?')[0]?.replace(/^\/api/, '')];
  return candidates.some((path) => path && PUBLIC_PATHS.includes(path));
}

/** Resolve the session user of a request, or null. */
export function sessionUser(auth, req) {
  const token = extractToken(req);
  if (!token) return null;
  const payload = auth.verifyToken(token);
  if (!payload) return null;
  return { email: payload.sub, jti: payload.jti };
}

/**
 * Middleware: 401 `unauthorized` when there is no valid session.
 * @param {{ store: import('../storage/jsonStore.mjs').JsonStore, logger: object }} ctx
 */
export function requireAuth({ store, logger }) {
  const auth = new AuthStore(store);
  auth.ensure();
  return (req, res, next) => {
    if (isPublic(req)) return next();
    const user = sessionUser(auth, req);
    if (!user) {
      logger?.warn('auth', 'unauthorized request', { url: req.originalUrl });
      return res
        .status(401)
        .json({ error: { code: 'unauthorized', message: 'Sessão não encontrada ou expirada. Faça login novamente.' } });
    }
    req.user = user;
    return next();
  };
}

/**
 * Small helper for routes mounted outside the guard (the /api/auth router
 * is registered before it): rejects the request when there is no session.
 */
export function requireSession({ store }) {
  const auth = new AuthStore(store);
  return (req, res, next) => {
    const user = sessionUser(auth, req);
    if (!user) {
      return res
        .status(401)
        .json({ error: { code: 'unauthorized', message: 'Sessão não encontrada ou expirada. Faça login novamente.' } });
    }
    req.user = user;
    return next();
  };
}
