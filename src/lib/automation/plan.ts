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

export const TEMPLATES_PLAN_MESSAGE = 'Templates are included in Relay Pro and Team. Upgrade your plan to use them.';

/**
 * Who may use templates (the library, saved templates, rules and drafts). Same plan rule as automation for coordinators:
 * Pro, Team or Brokerage only. Admins always. Agent workspaces by agent tier (using templates is in Basic and Pro).
 * Free collaborators never. The `templates` deployment flag is a separate switch that must also be on.
 */
export function userMayUseTemplates(user: WithAppMetadata | null | undefined): boolean {
  const ent = getEntitlements(user);
  if (ent.kind === 'admin') return true;
  if (!ent.canOwnWorkspace) return false;
  if (ent.kind === 'agent_workspace') return Boolean(ent.agentLevel && agentHas(ent.agentLevel, 'template_use'));
  return planIncludesAutomation(getUserPlan(user));
}

export function userMayAutomate(user: WithAppMetadata | null | undefined): boolean {
  const ent = getEntitlements(user);
  if (ent.kind === 'admin') return true;
  if (!ent.canOwnWorkspace) return false;
  if (ent.kind === 'agent_workspace') return Boolean(ent.agentLevel && agentHas(ent.agentLevel, 'automation'));
  return planIncludesAutomation(getUserPlan(user));
}
