/**
 * JobFinder — API client.
 * One thin wrapper around fetch for the local REST API.
 */

const BASE = '/api';

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function request(method, path, { body, raw, query, headers } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const init = { method, headers: { ...(headers ?? {}) } };
  if (body !== undefined) {
    if (raw) {
      // raw: body is already formatted (string / FormData / ArrayBuffer)
      init.body = body;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }

  const res = await fetch(url, init);
  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (res.status === 401 && data?.error?.code === 'unauthorized') {
    // Session expired/revoked: drop the auth state so the app redirects to /login.
    window.dispatchEvent(new Event('jobfinder:unauthorized'));
  }

  if (!res.ok) {
    const message = data?.error?.message ?? (typeof data === 'string' ? data : res.statusText);
    const err = new ApiError(message || `HTTP ${res.status}`, res.status, data?.error ?? data);
    throw err;
  }
  return data;
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  put: (path, body, options) => request('PUT', path, { ...options, body }),
  del: (path, options) => request('DELETE', path, options),
};
