import type { ApiError, AuthResponse } from "@offgrid/core";

/** The access token lives only in memory; the long-lived refresh token is an httpOnly cookie JS can't read. */
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

/** For the few calls that can't go through `api()`, like the chat stream. */
export function authHeader(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export class ApiFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

const NETWORK = () => new ApiFailure(0, "NETWORK", "Can't reach the OFFGRID server. Check your connection and try again.");

async function send(path: string, method: string, body: unknown): Promise<Response> {
  const isForm = body instanceof FormData;
  try {
    return await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        // For FormData the browser sets the multipart boundary itself.
        ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw NETWORK();
  }
}

let refreshing: Promise<AuthResponse | null> | null = null;

/**
 * Exchange the refresh cookie for a new access token. Concurrent callers share one request:
 * two parallel refreshes would present the same token twice, which the server treats as theft.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    try {
      const res = await send("/auth/refresh", "POST", undefined);
      // A 5xx (or a dev-proxy error) means the server is down, not that the user is logged out.
      if (res.status >= 500) throw NETWORK();
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const body = (await res.json()) as AuthResponse;
      accessToken = body.accessToken;
      return body;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? "GET";
  let res = await send(path, method, opts.body);
  // Access tokens last 15 minutes; refresh once and retry transparently.
  if (res.status === 401 && accessToken && !path.startsWith("/auth/")) {
    if (await refreshSession()) res = await send(path, method, opts.body);
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiFailure(
      res.status,
      err?.error.code ?? "HTTP_ERROR",
      err?.error.message ?? `Request failed (${res.status})`,
      err?.error.fields,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Multipart upload (photos). Same auth and refresh behaviour as `api`. */
export function upload<T>(path: string, form: FormData): Promise<T> {
  return api<T>(path, { method: "PUT", body: form });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
