import { AuthError } from './auth';
import { getEntitlements } from './entitlements';
import { agentHas, type AgentFeature } from './tiers';
import type { WithAppMetadata } from './appMetadata';

// Server-side gate for what a free brokerage workspace (Agent Basic) does not include. Only a Basic agent is ever stopped here:
// coordinators, admin-granted (Pro) agents and everyone else pass, so nothing changes for them. See tiers.ts for what each level has.

const MESSAGES: Partial<Record<AgentFeature, string>> = {
  custom_templates: 'Saving your own templates and emails is part of Agent Pro. Your workspace from your brokerage can use your brokerage\'s templates and Relay\'s standard forms.',
  automation: 'Automation, such as rules and workflows that run on their own, is part of Agent Pro.',
};

/** Throws 403 when this person is a Basic agent and the feature is not in Basic. */
export function assertAgentHas(user: WithAppMetadata, feature: AgentFeature): void {
  const level = getEntitlements(user).agentLevel;
  if (level === 'basic' && !agentHas('basic', feature)) throw new AuthError(MESSAGES[feature] ?? 'That is part of Agent Pro.', 403);
}
