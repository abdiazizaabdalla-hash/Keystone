import crypto from 'crypto';

/** A long, random, unguessable opaque token -- this is the ONLY auth on the public /external/[token] page and its API route, same pattern as generateSigningToken in lib/signing.ts. Treat it like a bearer credential. */
export function generateExternalAccessToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// External links default to a 14-day window, same as signing links
// (see SIGNING_LINK_EXPIRY_DAYS in api/signing-requests/route.ts) --
// long enough for a real closing timeline, short enough that a
// forgotten link doesn't stay live indefinitely.
export const EXTERNAL_LINK_EXPIRY_DAYS = 14;
