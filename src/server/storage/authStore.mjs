/**
 * JobFinder — local auth store (~/.jobfinder/auth.json).
 *
 * The app is local-first and single-user: the only account is created here
 * on first run, with the password hashed (scrypt, salt + timingSafeEqual)
 * so nothing sensible is written in plain text. Sessions are stateless
 * tokens (HMAC-SHA256 over base64url header/payload) delivered in an
 * HTTP-only cookie — the same token is also accepted as a Bearer token
 * for API tests (curl).
 *
 * The file lives in the data directory, next to config.json, and is never
 * published: only the password hash and a random session secret are stored.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { nowIso } from './jsonStore.mjs';

/** Pre-created local user (first run). */
export const DEFAULT_EMAIL = 'dan.hachuel@gmail.com';
export const DEFAULT_PASSWORD = '123456';
export const DEFAULT_USER_NAME = 'Dan';

/** Cookie used to keep the local session in the browser. */
export const SESSION_COOKIE = 'jobfinder_session';
/** Session lifetime: 7 days (re-issued at every login). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SCRYPT_KEYLEN = 64;
const MIN_PASSWORD_LENGTH = 6;

/* ------------------------------------------------------------------ *
 * Password hashing (scrypt — native Node crypto, no dependency)      *
 * ------------------------------------------------------------------ */

/** Hash a plain password: "scrypt$<salt>$<hash>" (both hex). */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/** Constant-time verification of a password against a stored hash. */
export function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  let candidate;
  try {
    candidate = scryptSync(String(password), salt, SCRYPT_KEYLEN);
  } catch {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (candidate.length !== expectedBuffer.length) return false;
  return timingSafeEqual(candidate, expectedBuffer);
}

/* ------------------------------------------------------------------ *
 * Session tokens (JWT-shaped, signed with the local session secret)  *
 * ------------------------------------------------------------------ */

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(data, secret) {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Issue a signed session token for the given e-mail. */
export function createSessionToken(email, secret, { expiresInMs = SESSION_TTL_MS } = {}) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const issuedAt = Date.now();
  const payload = base64url(
    JSON.stringify({
      sub: String(email).toLowerCase(),
      iat: Math.floor(issuedAt / 1000),
      exp: Math.floor((issuedAt + expiresInMs) / 1000),
      jti: randomBytes(8).toString('hex'),
    })
  );
  const signature = sign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

/** Validate a token: returns the payload or null (tampered/expired). */
export function verifySessionToken(token, secret) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3 || !secret) return null;
  const [header, payload, signature] = parts;
  if (!safeEqual(sign(`${header}.${payload}`, secret), signature)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.sub || !data?.exp) return null;
    if (Date.now() >= Number(data.exp) * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

/** Default content of auth.json (first run). */
export function defaultAuthPayload() {
  return {
    schemaVersion: 1,
    createdAt: nowIso(),
    sessionSecret: randomBytes(32).toString('hex'),
    user: {
      email: DEFAULT_EMAIL,
      name: DEFAULT_USER_NAME,
      passwordHash: hashPassword(DEFAULT_PASSWORD),
      passwordUpdatedAt: nowIso(),
    },
    /** Revoked token ids (logout) — only the last 50 are kept. */
    revokedTokens: [],
  };
}

/* ------------------------------------------------------------------ *
 * AuthStore                                                          *
 * ------------------------------------------------------------------ */

export class AuthStore {
  /** @param {import('./jsonStore.mjs').JsonStore} store */
  constructor(store) {
    this.store = store;
  }

  /** Raw file content (never sent to the browser). */
  read() {
    return this.store.read('auth.json', null) ?? {};
  }

  /**
   * Idempotent bootstrap/migration: creates auth.json with the default
   * user when missing and fills any gap of an older file (secret/user).
   * Safe to call on every startup.
   * @returns {{ created: boolean }}
   */
  ensure() {
    const existing = this.store.read('auth.json', null);
    if (existing?.user?.passwordHash && existing.sessionSecret && Array.isArray(existing.revokedTokens)) {
      return { created: false };
    }
    const defaults = defaultAuthPayload();
    this.store.update(
      'auth.json',
      (current) => {
        const base = current && typeof current === 'object' ? { ...defaults, ...current } : defaults;
        const next = { ...base };
        if (!next.user?.passwordHash) next.user = { ...defaults.user, ...(next.user ?? {}) };
        if (!next.sessionSecret) next.sessionSecret = defaults.sessionSecret;
        if (!Array.isArray(next.revokedTokens)) next.revokedTokens = [];
        return next;
      },
      {}
    );
    return { created: !existing };
  }

  /** Public view of the local user (no secrets). */
  getUser() {
    const data = this.read();
    const user = data.user ?? {};
    return {
      email: user.email ?? DEFAULT_EMAIL,
      name: user.name ?? DEFAULT_USER_NAME,
      passwordUpdatedAt: user.passwordUpdatedAt ?? null,
      createdAt: data.createdAt ?? null,
    };
  }

  /** True when the account still uses the first-run password. */
  usingDefaultPassword() {
    return verifyPassword(DEFAULT_PASSWORD, this.read().user?.passwordHash);
  }

  /** Check credentials; returns the public user or null. */
  verifyCredentials(email, password) {
    const data = this.read();
    const user = data.user ?? {};
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    if (!normalizedEmail || normalizedEmail !== String(user.email ?? '').toLowerCase()) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    return this.getUser();
  }

  /**
   * Change the password of the local user.
   * Throws an Error with status/code (mapped by the error middleware).
   */
  changePassword({ currentPassword, newPassword, confirmPassword }) {
    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      throw authError('A nova senha e a confirmação não coincidem.');
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw authError(`A nova senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
    if (!verifyPassword(currentPassword, this.read().user?.passwordHash)) {
      throw authError('Senha atual incorreta.');
    }
    const passwordHash = hashPassword(newPassword);
    this.store.update(
      'auth.json',
      (current) => ({
        ...(current ?? {}),
        user: {
          ...(current?.user ?? {}),
          passwordHash,
          passwordUpdatedAt: nowIso(),
        },
      }),
      {}
    );
    return this.getUser();
  }

  /** Issue a session token for the user. */
  issueToken(email = DEFAULT_EMAIL) {
    const data = this.read();
    const secret = data.sessionSecret;
    if (!secret) throw authError('auth.json sem sessionSecret — apague o arquivo para recriá-lo.');
    return createSessionToken(email ?? data.user?.email ?? DEFAULT_EMAIL, secret);
  }

  /** Validate a token: returns the payload or null. */
  verifyToken(token) {
    const data = this.read();
    const payload = verifySessionToken(token, data.sessionSecret);
    if (!payload) return null;
    const revoked = Array.isArray(data.revokedTokens) ? data.revokedTokens : [];
    if (payload.jti && revoked.includes(payload.jti)) return null;
    return payload;
  }

  /** Invalidate a token (logout). */
  revokeToken(token) {
    const payload = verifySessionToken(token, this.read().sessionSecret);
    if (!payload?.jti) return;
    this.store.update(
      'auth.json',
      (current) => {
        const revoked = Array.isArray(current?.revokedTokens) ? current.revokedTokens : [];
        return {
          ...(current ?? {}),
          revokedTokens: [...revoked.filter((jti) => jti !== payload.jti), payload.jti].slice(-50),
        };
      },
      {}
    );
  }
}

function authError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'bad_request';
  err.expose = true;
  return err;
}

/* ------------------------------------------------------------------ *
 * HTTP helpers (cookie + bearer)                                     *
 * ------------------------------------------------------------------ */

/** Parse a Cookie header into a plain object. */
export function parseCookieHeader(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[key] = part.slice(index + 1).trim();
    }
  }
  return out;
}

/** Extract the session token from the cookie header or Authorization. */
export function extractToken(req) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  const authorization = String(req.headers?.authorization ?? '');
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  return null;
}

/** Cookie options for the local session (httpOnly; no Secure: plain http). */
export function sessionCookieOptions(extra = {}) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
    ...extra,
  };
}
