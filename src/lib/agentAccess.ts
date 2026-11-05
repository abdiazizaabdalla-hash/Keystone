import { supabaseServer } from './supabase';
import { getUserPlan, type WithAppMetadata } from './appMetadata';
import { mayGetBrokerageAccess, withBrokerageAccess } from './brokerageAccessMeta';
import { effectiveStatus } from './brokeragePilot';
import { isFeatureOn } from './features';
import { isTeamPlan } from './plans';

// Agent Basic: the workspace an agent gets, free, because a brokerage in good standing has them on its roster
// (see docs/PRICING_ENTITLEMENT_DESIGN.md, tiers.ts).
//
// Nothing is written to the agent. On each request, for an agent who has no workspace grant of their own, we look for an active
// brokerage link whose owner is still on a team plan, and if there is one we mark THIS request's copy of the user as a workspace
// agent whose access comes from the brokerage. Because it is worked out on read, the access ends by itself the moment the link
// ends (the agent leaves, the owner removes them, or the owner drops off a team plan), and a stored grant can never go stale.
//
// A brokerage that has lapsed (see below) leaves its agents read-only rather than cutting them off.
//
// Every existing check (getEntitlements, isCollaboratorOnly, authorizeDeal) reads these fields, so no route has to change to
// treat a Basic agent as a workspace agent.

/**
 * Marks the user as a Basic workspace agent for this request when a brokerage in good standing has them. Never throws: if the lookup
 * fails (for example the brokerage tables are not in this database yet) the user stays a free portal login, which is the safe side.
 */
export async function applyBrokerageAccess<T extends WithAppMetadata & { id: string }>(user: T): Promise<T> {
  if (!mayGetBrokerageAccess(user, { brokerage: isFeatureOn('brokerage'), agentWorkspace: isFeatureOn('agent_workspace') })) return user;
  try {
    const { data: link } = await supabaseServer.from('brokerage_links').select('owner_user_id').eq('agent_user_id', user.id).eq('status', 'active').maybeSingle();
    if (!link?.owner_user_id) return user;
    const ownerId = link.owner_user_id as string;
    const { data: owner } = await supabaseServer.auth.admin.getUserById(ownerId);
    if (!owner.user) return user;
    // The agent keeps their workspace for as long as they are on the roster. It becomes read-only when the brokerage has lapsed: the
    // owner is off a team plan, or the pilot has ended or the account was paused (brokeragePilot.ts). Nothing is deleted.
    let lapsed = !isTeamPlan(getUserPlan(owner.user as WithAppMetadata));
    if (!lapsed) {
      const { data: account } = await supabaseServer.from('brokerage_accounts').select('status, pilot_ends_on').eq('owner_user_id', ownerId).maybeSingle();
      if (account) {
        const status = effectiveStatus({ status: account.status as 'pilot', pilot_ends_on: (account.pilot_ends_on as string | null) ?? null }, new Date().toISOString().slice(0, 10));
        lapsed = status === 'pilot_expired' || status === 'terminated';
      }
    }
    return withBrokerageAccess(user, { readOnly: lapsed });
  } catch (error) {
    console.error('Brokerage access lookup failed:', error);
    return user;
  }
}

export { ACCESS_SOURCE_KEY, BROKERAGE_ACCESS_SOURCE, READ_ONLY_KEY, hasBrokerageAccess, isBrokerageReadOnly, readOnlyAllows, READ_ONLY_MESSAGE } from './brokerageAccessMeta';
