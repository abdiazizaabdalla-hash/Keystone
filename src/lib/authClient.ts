'use client';

import { supabaseBrowser as supabase } from './supabaseClient';

const ACCESS_TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const USER_ID_KEY = 'user_id';

export class AuthRequiredError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

function decodeExp(token: string): number | null {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Reads the account role straight out of the currently-stored access
 * token (if any), with no network round-trip -- used only for client-side
 * routing decisions (e.g. "should a reload send this session to /agent or
 * /dashboard?"). This is unverified, exactly like decodeExp above: it's
 * purely a UX shortcut, never a security boundary -- every real API route
 * independently re-validates the token and checks role server-side via
 * isAgentUser(). Returns null if there's no token or it can't be decoded.
 */
export function decodeStoredRole(): string | null {
  try {
    const token = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) return null;
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    // app_metadata is where the server stores it (see lib/privileged.ts);
    // user_metadata is only a fallback for tokens issued before that move.
    const role = payload?.app_metadata?.role ?? payload?.user_metadata?.role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

export function saveSession(accessToken: string, refreshToken: string, userId: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem(USER_ID_KEY, userId);
}

export function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_ID_KEY);
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    clearSession();
    return null;
  }

  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      clearSession();
      return null;
    }
    saveSession(data.session.access_token, data.session.refresh_token, data.session.user.id);
    return data.session.access_token;
  } catch {
    clearSession();
    return null;
  }
}

/**
 * Returns a currently-valid access token, transparently refreshing it first
 * if it is missing, expired, or about to expire (within 60s). Returns null
 * if there's no session at all or the refresh attempt failed (session
 * storage is cleared in that case).
 */
export async function getValidToken(): Promise<string | null> {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!token) return null;

  const exp = decodeExp(token);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const isExpiringSoon = exp === null || exp - nowSeconds < 60;

  if (!isExpiringSoon) return token;

  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * fetch() wrapper that attaches a valid Bearer token, auto-refreshing it
 * beforehand when it's expired/expiring, and retrying once more on an
 * unexpected 401 in case the token expired mid-flight. Throws
 * AuthRequiredError when there's no way to get a valid token (caller should
 * redirect to /auth).
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getValidToken();
  if (!token) {
    throw new AuthRequiredError();
  }

  const doFetch = (accessToken: string) =>
    fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });

  let response = await doFetch(token);

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      throw new AuthRequiredError();
    }
    response = await doFetch(refreshed);
  }

  return response;
}
