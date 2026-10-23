import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseServer } from '@/lib/supabase';
import { hasAgentRole } from '@/lib/privileged';

// A sign-in link for an agent that can be opened more than once for a while.
//
// Why this exists: Supabase's own magic links are strictly single-use. Mail apps and security scanners
// "pre-open" links in the background, which burns the link before the agent clicks it, and the agent then
// sees "link invalid or expired". These links are different: the link carries a signed, time-limited
// token (nothing is stored, nothing is "used up"). Opening the link only shows our page; the page then
// exchanges the token for a real session. It works for every open until it expires.
//
// It can only ever sign in an existing agent-portal account. A coordinator's login (password, two-step
// sign-in) can never be reached through it.

/** How long an emailed sign-in link keeps working. The minimum promised is 5 minutes; 30 leaves room for slow inboxes. */
export const AGENT_LOGIN_LINK_MINUTES = 30;

function key(): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('No server secret available to sign agent login links');
  return `relay-agent-login-link:${secret}`;
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function sign(payload: string): string {
  return b64url(createHmac('sha256', key()).update(payload).digest());
}

export function createAgentLoginToken(email: string, minutes = AGENT_LOGIN_LINK_MINUTES): string {
  const payload = b64url(Buffer.from(JSON.stringify({ e: email.trim().toLowerCase(), x: Date.now() + minutes * 60 * 1000 })));
  return `${payload}.${sign(payload)}`;
}

/** Returns the email a valid, unexpired token was made for, or why it is not usable. */
export function readAgentLoginToken(token: string): { email: string } | { error: 'invalid' | 'expired' } {
  if (typeof token !== 'string' || token.length > 600) return { error: 'invalid' };
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return { error: 'invalid' };
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { error: 'invalid' };
  try {
    const data = JSON.parse(fromB64url(payload).toString('utf8')) as { e?: unknown; x?: unknown };
    if (typeof data.e !== 'string' || typeof data.x !== 'number') return { error: 'invalid' };
    if (Date.now() > data.x) return { error: 'expired' };
    return { email: data.e };
  } catch {
    return { error: 'invalid' };
  }
}

/**
 * Finds the agent-portal account for an email without leaving a new account behind. (Supabase can only look a user
 * up by email through generateLink, which creates a user that does not exist, so a just-created stray account is
 * removed again.) Returns the account only when it is an agent login; anything else (no account, a coordinator's
 * login) is null.
 */
export async function findAgentAccount(email: string): Promise<{ userId: string; hashedToken: string } | null> {
  const { data, error } = await supabaseServer.auth.admin.generateLink({ type: 'magiclink', email });
  const user = data?.user;
  const hashedToken = data?.properties?.hashed_token;
  if (error || !user || !hashedToken) return null;

  if (!hasAgentRole(user)) {
    const justCreated = !user.last_sign_in_at && Date.now() - new Date(user.created_at).getTime() < 60 * 1000;
    if (justCreated) {
      await supabaseServer.auth.admin.deleteUser(user.id).catch((err) => console.error('Could not remove a stray account created by a login-link lookup:', err));
    }
    return null;
  }
  return { userId: user.id, hashedToken };
}
