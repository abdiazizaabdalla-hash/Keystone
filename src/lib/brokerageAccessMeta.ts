import { hasAgentRole, isPlatformAdmin, type WithAppMetadata } from './appMetadata';

// The pure half of Agent Basic (no database), so entitlements.ts and tests can use it. See agentAccess.ts for the lookup.

export const BROKERAGE_ACCESS_SOURCE = 'brokerage';
export const ACCESS_SOURCE_KEY = 'agent_access_source';

/** True when this user's workspace comes from a brokerage (so the Starter trial and its paywall do not apply to them). */
export function hasBrokerageAccess(user: WithAppMetadata | null | undefined): boolean {
  return user?.app_metadata?.[ACCESS_SOURCE_KEY] === BROKERAGE_ACCESS_SOURCE;
}

/** Pure part: should we even look? An agent with no workspace of their own, while both features are on. Admins are never changed. */
export function mayGetBrokerageAccess(user: WithAppMetadata | null | undefined, flags: { brokerage: boolean; agentWorkspace: boolean }): boolean {
  if (!flags.brokerage || !flags.agentWorkspace) return false;
  if (!hasAgentRole(user) || isPlatformAdmin(user)) return false;
  return user?.app_metadata?.agent_workspace !== true;
}

export const READ_ONLY_KEY = 'agent_read_only';

/** True when this agent's brokerage has lapsed: they keep everything and can read it, but cannot create or change anything. */
export function isBrokerageReadOnly(user: WithAppMetadata | null | undefined): boolean {
  return hasBrokerageAccess(user) && user?.app_metadata?.[READ_ONLY_KEY] === true;
}

export const READ_ONLY_MESSAGE = "Your brokerage's Relay plan has ended, so your workspace is read-only for now. Everything you have is still here. Ask your broker to upgrade to Brokerage Pro to edit again.";

/** Writes a read-only agent can still make: talking to people, leaving or declining the brokerage, notifications, and their own sign-in and data export. */
const READ_ONLY_WRITE_PREFIXES = ['/api/brokerage', '/api/brokerage-messages', '/api/team/messages', '/api/messages', '/api/direct-messages', '/api/agent/messages', '/api/notifications', '/api/auth', '/api/account'];

/** Pure rule: may a read-only agent make this request? Anything that only reads is allowed. */
export function readOnlyAllows(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  return READ_ONLY_WRITE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Pure part: the user as this request should see them once the brokerage link and owner plan are known.
 * `readOnly` marks a lapsed brokerage (pilot ended or terminated, or the owner is off a team plan).
 */
export function withBrokerageAccess<T extends WithAppMetadata>(user: T, opts: { readOnly?: boolean } = {}): T {
  user.app_metadata = { ...(user.app_metadata ?? {}), agent_workspace: true, [ACCESS_SOURCE_KEY]: BROKERAGE_ACCESS_SOURCE, ...(opts.readOnly ? { [READ_ONLY_KEY]: true } : {}) };
  return user;
}
