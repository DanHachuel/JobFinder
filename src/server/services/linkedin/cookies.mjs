/**
 * JobFinder — cookies.txt parsing.
 *
 * Accepts the Netscape format exported by the "Get cookies.txt LOCALLY"
 * browser extension (and the JSON variant some tools export). The parsed
 * cookies are persisted in channels.json — they never leave the machine.
 */

/** Parse a Netscape cookies.txt (tolerant: comments, blank lines, junk). */
export function parseNetscapeCookies(text) {
  const cookies = [];
  const lines = String(text).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 7) {
      // Some exporters separate with spaces instead of tabs.
      const spaced = line.split(/\s{2,}/);
      if (spaced.length >= 7) {
        parts.push(...spaced);
      } else {
        continue;
      }
    }
    const [domain, , path = '/', secure = 'FALSE', expires, name, value] = parts;
    if (!domain || !name) continue;
    cookies.push({
      name: name.trim(),
      value: (value ?? '').trim(),
      domain: domain.trim(),
      path: path.trim(),
      secure: String(secure).toUpperCase().includes('TRUE'),
      expires: Number(expires) || 0,
    });
  }
  return cookies;
}

/** Parse the JSON export format ([{name, value, domain, path, ...}]). */
export function parseJsonCookies(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('JSON cookies must be an array');
  return data
    .filter((c) => c && typeof c === 'object' && c.name)
    .map((c) => ({
      name: String(c.name),
      value: String(c.value ?? ''),
      domain: String(c.domain ?? '.www.linkedin.com'),
      path: String(c.path ?? '/'),
      secure: Boolean(c.secure),
      expires: Number(c.expirationDate ?? c.expires ?? 0) || 0,
    }));
}

/** Auto-detect format and parse. Returns cookies (possibly empty). */
export function parseCookiesText(text) {
  const trimmed = String(text).trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return parseJsonCookies(trimmed);
    } catch {
      /* fall through to Netscape parsing */
    }
  }
  return parseNetscapeCookies(text);
}

/** The cookie names that matter for a LinkedIn session. */
export const REQUIRED_COOKIES = ['li_at', 'JSESSIONID'];

/** Build the Cookie header value for a request to a given host. */
export function cookieHeader(cookies, host = 'www.linkedin.com') {
  const relevant = cookies.filter((c) => {
    const domain = c.domain?.replace(/^\./, '') ?? '';
    return host.endsWith(domain) || domain.endsWith(host);
  });
  return relevant.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** Find the JSESSIONID value (used as csrf-token). */
export function getJsessionId(cookies) {
  const cookie = cookies.find((c) => c.name === 'JSESSIONID');
  return cookie ? cookie.value.replace(/^"|"$/g, '') : null;
}

/** True when the cookie set looks like a LinkedIn session. */
export function looksLikeLinkedinSession(cookies) {
  return REQUIRED_COOKIES.every((name) => cookies.some((c) => c.name === name && c.value));
}
