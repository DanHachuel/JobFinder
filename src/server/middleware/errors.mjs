/**
 * JobFinder — HTTP helpers.
 */

/** An error that maps directly to an HTTP response. */
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

/** Wrap an async route handler so rejected promises reach the error middleware. */
export function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** 400 bad request — throw this. */
export function badRequest(message, details) {
  return new HttpError(400, 'bad_request', message, details);
}

/** 404 not found — throw this. */
export function notFound(what = 'Resource') {
  return new HttpError(404, 'not_found', `${what} not found`);
}

/** 409 conflict — throw this. */
export function conflict(message, details) {
  return new HttpError(409, 'conflict', message, details);
}

/** 503 when a required integration (LinkedIn auth, LLM) is missing. */
export function serviceUnavailable(what) {
  return new HttpError(503, 'service_unavailable', `${what} is not configured`);
}

/** 502 when an upstream provider (LinkedIn, LLM) fails. */
export function badGateway(what, details) {
  return new HttpError(502, 'bad_gateway', `${what} failed`, details);
}
