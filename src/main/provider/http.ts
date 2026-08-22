/**
 * Shared JSON transport for provider adapters (M5-02) and connection tests (M5-01).
 *
 * Security constraints (CONTRACT §6 / UI §7.1):
 * - Only HTTPS; same-origin redirects only, capped hops; cross-host redirect rejected.
 * - The caller resolves the API key and injects it here; it is only sent as the
 *   Authorization Bearer header and never appears in any returned value or error.
 */

export type ProviderTransportErrorKind =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'REDIRECT'
  | 'VALIDATION';

export class ProviderTransportError extends Error {
  constructor(
    public readonly kind: ProviderTransportErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderTransportError';
  }
}

export interface FetchJsonInput {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  apiKey?: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  maxRedirects?: number;
  /** Hard cap on the response body to bound memory (default 1 MiB). */
  maxBodyBytes?: number;
  /** Test-only escape hatch: allow loopback http:// for integration tests. Production call sites must never set it. */
  allowInsecure?: boolean;
}

export interface FetchJsonResponse {
  status: number;
  body: unknown;
  finalUrl: string;
}

/** Append an API path to a base URL; handles an existing /v1 path and trailing slash. */
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Enforce CONTRACT HTTPS rules defensively; the schema also enforces them at config time. */
export function assertSecureHttpsUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderTransportError('VALIDATION', 'Invalid provider base URL');
  }
  if (url.protocol !== 'https:') {
    throw new ProviderTransportError('VALIDATION', 'Provider base URL must use HTTPS');
  }
  if (url.username || url.password) {
    throw new ProviderTransportError('VALIDATION', 'Provider base URL must not contain userinfo');
  }
  if (url.search || url.hash) {
    throw new ProviderTransportError('VALIDATION', 'Provider base URL must not contain query or fragment');
  }
}

/**
 * Resolve a Location header against the current URL, rejecting cross-host or
 * protocol-change redirects (UI §7.1: 禁止跨 host 重定向). Production URLs are
 * https; allowing loopback http only for integration tests that opt in.
 */
export function resolveRedirectUrl(currentUrl: string, location: string): string {
  let target: URL;
  try {
    target = new URL(location, currentUrl);
  } catch {
    throw new ProviderTransportError('REDIRECT', 'Provider returned an invalid redirect');
  }
  const current = new URL(currentUrl);
  if (target.protocol !== current.protocol) {
    throw new ProviderTransportError('REDIRECT', 'Provider redirect must not change protocol');
  }
  if (target.username || target.password) {
    throw new ProviderTransportError('REDIRECT', 'Provider redirect must not contain userinfo');
  }
  if (target.search || target.hash) {
    throw new ProviderTransportError('REDIRECT', 'Provider redirect must not contain query or fragment');
  }
  if (target.origin !== current.origin) {
    throw new ProviderTransportError('REDIRECT', 'Provider redirect crossed host boundaries');
  }
  return target.toString();
}

/** POST/GET JSON with manual same-origin redirect following and timeout/abort support. */
export async function fetchJson(input: FetchJsonInput): Promise<FetchJsonResponse> {
  if (!input.allowInsecure) {
    assertSecureHttpsUrl(input.baseUrl);
  }
  const maxRedirects = input.maxRedirects ?? 3;
  let url = joinUrl(input.baseUrl, input.path);
  let redirects = 0;

  for (;;) {
    const signal = AbortSignal.any([
      AbortSignal.timeout(input.timeoutMs),
      ...(input.abortSignal ? [input.abortSignal] : []),
    ]);

    let res: Response;
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
      res = await fetch(url, {
        method: input.method ?? 'POST',
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        redirect: 'manual',
        signal,
      });
    } catch (err) {
      throw normalizeFetchError(err);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) {
        if (redirects >= maxRedirects) {
          throw new ProviderTransportError('REDIRECT', 'Provider redirect limit exceeded');
        }
        url = resolveRedirectUrl(url, location);
        redirects += 1;
        continue;
      }
    }

    let body: unknown;
    const text = await readTextLimited(res, input.maxBodyBytes ?? 1_048_576);
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: res.status, body, finalUrl: res.url };
  }
}

async function readTextLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ProviderTransportError('VALIDATION', 'Provider response body exceeded limit');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function normalizeFetchError(err: unknown): ProviderTransportError {
  const name = err instanceof DOMException ? err.name : (err as { name?: string })?.name;
  if (name === 'TimeoutError') {
    return new ProviderTransportError('TIMEOUT', 'Provider request timed out');
  }
  if (name === 'AbortError') {
    return new ProviderTransportError('ABORTED', 'Provider request aborted');
  }
  return new ProviderTransportError('NETWORK', 'Provider network request failed');
}
