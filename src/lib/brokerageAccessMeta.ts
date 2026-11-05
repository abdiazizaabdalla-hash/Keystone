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

/** Pure part: the user as this request should see them once the brokerage link and owner plan are known. */
export function withBrokerageAccess<T extends WithAppMetadata>(user: T): T {
  user.app_metadata = { ...(user.app_metadata ?? {}), agent_workspace: true, [ACCESS_SOURCE_KEY]: BROKERAGE_ACCESS_SOURCE };
  return user;
}
