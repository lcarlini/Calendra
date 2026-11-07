/**
 * Small HTTP layer: timeout, retry with exponential backoff, Retry-After
 * handling and a per-host circuit breaker. Pure of DOM, so it runs in Node tests.
 */

export class HttpError extends Error {
  constructor(message, { status = 0, retryAfterMs = 0, url = '' } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.url = url;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

/** Opens after `threshold` consecutive failures; stays open for `cooldownMs`. */
export function createCircuitBreaker({ threshold = 3, cooldownMs = 60_000, now = () => Date.now() } = {}) {
  const state = new Map();
  return {
    isOpen(key) {
      const s = state.get(key);
      return Boolean(s && s.openUntil > now());
    },
    success(key) {
      state.delete(key);
    },
    failure(key) {
      const s = state.get(key) || { failures: 0, openUntil: 0 };
      s.failures += 1;
      if (s.failures >= threshold) s.openUntil = now() + cooldownMs;
      state.set(key, s);
    },
  };
}

export const defaultBreaker = createCircuitBreaker();

/**
 * Fetch and read a response with `read(response)`.
 * Retries network errors, 429 and 5xx; other 4xx fail immediately.
 */
async function request(url, read, opts = {}) {
  const {
    timeoutMs = 10_000,
    retries = 2,
    backoffMs = 500,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    breaker = defaultBreaker,
    headers,
    method = 'GET',
    body,
    signal,
  } = opts;

  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  if (breaker.isOpen(host)) {
    throw new HttpError(`Temporarily paused after repeated failures: ${host}`, { url });
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (signal?.aborted) throw new HttpError('Cancelled', { url });
      const res = await fetchImpl(url, { method, headers, body, signal: controller.signal });
      if (res.ok) {
        const value = await read(res);
        breaker.success(host);
        return value;
      }
      const retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
      lastError = new HttpError(`HTTP ${res.status}`, { status: res.status, retryAfterMs, url });
      if (res.status !== 429 && res.status < 500) break;
    } catch (error) {
      if (signal?.aborted) {
        throw new HttpError('Cancelled', { url });
      }
      lastError =
        error instanceof HttpError
          ? error
          : new HttpError(error?.name === 'AbortError' ? 'Timed out' : error?.message || 'Network error', { url });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
    if (attempt < retries) {
      await sleep(Math.max(lastError?.retryAfterMs || 0, backoffMs * 2 ** attempt));
    }
  }
  breaker.failure(host);
  throw lastError;
}

export const fetchJson = (url, opts) => request(url, (res) => res.json(), opts);
export const fetchText = (url, opts) => request(url, (res) => res.text(), opts);
