import crypto from 'crypto';

/**
 * Signs/verifies the opaque `state` param round-tripped through a
 * third-party OAuth redirect (Google Calendar today). The callback is a
 * plain browser GET from Google -- no Authorization header, no Relay
 * session -- so `state` is how we both (a) prove the redirect actually
 * came from a flow we started, not something an attacker crafted, and
 * (b) recover which of our users it was for, without a server-side
 * "pending OAuth attempts" table.
 *
 * Reuses GOOGLE_CLIENT_SECRET as the signing key rather than introducing
 * a dedicated env var -- it's already a secret only our server holds,
 * and it's required for the OAuth flow to work at all anyway.
 */
function getStateSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) {
    throw new Error('GOOGLE_CLIENT_SECRET is not set — cannot start a Google OAuth flow');
  }
  return secret;
}

interface OAuthStatePayload {
  userId: string;
  from: 'settings' | 'onboarding';
  exp: number;
}

/** Signs a short-lived (10 minute) state token identifying who started the OAuth flow and where to send them back. */
export function signOAuthState(userId: string, from: 'settings' | 'onboarding' = 'settings'): string {
  const payload: OAuthStatePayload = { userId, from, exp: Date.now() + 10 * 60 * 1000 };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', getStateSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

/** Verifies a state token from signOAuthState(). Returns null if it's missing, tampered with, expired, or malformed. */
export function verifyOAuthState(token: string): { userId: string; from: 'settings' | 'onboarding' } | null {
  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) return null;

  const expectedSignature = crypto.createHmac('sha256', getStateSecret()).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Partial<OAuthStatePayload>;
    if (typeof payload.userId !== 'string' || typeof payload.exp !== 'number') return null;
    if (Date.now() > payload.exp) return null;
    return { userId: payload.userId, from: payload.from === 'onboarding' ? 'onboarding' : 'settings' };
  } catch {
    return null;
  }
}
