import { getEntitlements } from '../entitlements';
import { agentHas } from '../tiers';
import { getUserPlan, type WithAppMetadata } from '../appMetadata';
import { isTeamPlan } from '../plans';

// Who may use automation (the assistant, workflows, tracker, approvals). Pure, so the server, the guard and the tests agree.
//   Coordinators: Pro, Team or Brokerage plans only. Starter (trial or paid) does not include it.
//   Admins: always (to support and test). Agent workspaces: by agent tier (Pro yes, brokerage-provided Basic no).
//   Free collaborators: never.

export const AUTOMATION_PLAN_MESSAGE = 'Automation is included in Relay Pro and Team. Upgrade your plan to use it.';

export function planIncludesAutomation(plan: string | null | undefined): boolean {
  return plan === 'pro' || isTeamPlan(plan);
}

export function userMayAutomate(user: WithAppMetadata | null | undefined): boolean {
  const ent = getEntitlements(user);
  if (ent.kind === 'admin') return true;
  if (!ent.canOwnWorkspace) return false;
  if (ent.kind === 'agent_workspace') return Boolean(ent.agentLevel && agentHas(ent.agentLevel, 'automation'));
  return planIncludesAutomation(getUserPlan(user));
}
