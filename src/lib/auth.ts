import { NextRequest } from 'next/server';
import { supabase } from './supabase';
import { isPlatformAdmin } from './privileged';

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export const MFA_REQUIRED_MESSAGE = 'Two-factor verification required';

/** Reads the `aal` (authenticator assurance level) claim from an already-validated access token. */
function tokenAssuranceLevel(token: string): string | null {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    return typeof payload.aal === 'string' ? payload.aal : null;
  } catch {
    return null;
  }
}

/**
 * Validates the Bearer token and returns the user. Accounts that turned on
 * two-step sign-in must present a token from a session that completed the
 * authenticator-app step (aal2): a password alone -- aal1 -- is rejected
 * everywhere except the few MFA routes that pass `allowAal1`.
 */
export async function getUserFromRequest(request: NextRequest, options: { allowAal1?: boolean } = {}) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid authorization token', 401);
  }

  const token = authHeader.substring(7);
  // IMPORTANT: validate the caller's token with the anon-key client, never
  // with `supabaseServer` (the service-role client). Calling
  // `.auth.getUser(token)` on a shared client instance updates that
  // client's internal session state, which then leaks into the
  // Authorization header of every later request made on that same
  // instance — including Storage uploads — silently downgrading them from
  // service-role to the logged-in user's own token. Keeping
  // `supabaseServer` untouched by any end-user token is what keeps it
  // reliably privileged for the rest of the request.
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw new AuthError('Unauthorized', 401);
  }

  if (!options.allowAal1) {
    const hasVerifiedFactor = (user.factors || []).some((f) => f.status === 'verified');
    const mfaEnabled = hasVerifiedFactor || (user.app_metadata as { mfa_enabled?: boolean } | null)?.mfa_enabled === true;
    if (mfaEnabled && tokenAssuranceLevel(token) !== 'aal2') {
      throw new AuthError(MFA_REQUIRED_MESSAGE, 401);
    }
  }

  const isAdmin = isPlatformAdmin(user);

  return { user, isAdmin };
}
