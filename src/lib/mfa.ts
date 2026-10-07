import { supabaseServer } from './supabase';

// Thin wrappers over Supabase Auth's MFA (TOTP / authenticator-app) REST
// endpoints, called with the USER's access token. Done with plain fetch
// rather than a supabase-js client so no session state is ever attached to
// a shared client (see the warnings in lib/supabase.ts).

const baseUrl = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;

function headers(accessToken: string) {
  return {
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function call<T>(accessToken: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: headers(accessToken),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { msg?: string; message?: string; error_description?: string }).msg
      || (data as { message?: string }).message
      || (data as { error_description?: string }).error_description
      || 'Authentication service error';
    throw new MfaError(message, res.status);
  }
  return data as T;
}

export class MfaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface EnrolledFactor {
  id: string;
  totp: { qr_code: string; secret: string; uri: string };
}

export function enrollTotp(accessToken: string, friendlyName: string) {
  return call<EnrolledFactor>(accessToken, 'POST', '/factors', { factor_type: 'totp', friendly_name: friendlyName });
}

export function unenrollFactor(accessToken: string, factorId: string) {
  return call<unknown>(accessToken, 'DELETE', `/factors/${factorId}`);
}

export interface MfaSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: { id: string };
}

/** Starts a challenge for the factor and verifies the 6-digit code in one go; returns the upgraded (aal2) session. */
export async function challengeAndVerify(accessToken: string, factorId: string, code: string): Promise<MfaSession> {
  const challenge = await call<{ id: string }>(accessToken, 'POST', `/factors/${factorId}/challenge`);
  return call<MfaSession>(accessToken, 'POST', `/factors/${factorId}/verify`, {
    challenge_id: challenge.id,
    code,
  });
}

type FactorLike = { id: string; factor_type?: string; status?: string };

/**
 * The account's verified authenticator-app factor, if any. Uses the factors
 * on the user object when present and falls back to a service-role lookup,
 * so this works however the auth API shaped the user it returned.
 */
export async function findVerifiedTotpFactor(user: { id: string; factors?: FactorLike[] | null }): Promise<FactorLike | null> {
  const fromUser = (user.factors || []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
  if (fromUser) return fromUser;
  if (user.factors && user.factors.length > 0) return null;
  const { data } = await supabaseServer.auth.admin.getUserById(user.id);
  const factors = (data?.user?.factors || []) as FactorLike[];
  return factors.find((f) => f.factor_type === 'totp' && f.status === 'verified') || null;
}
