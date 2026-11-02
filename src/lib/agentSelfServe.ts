// Agents signing themselves up for their own Relay workspace is OFF until the
// agent plan, trial and entitlement rules exist (see docs/RELAY_IMPLEMENTATION_PLAN.md).
// Agents reach Relay today only as free collaborators invited by a paying
// coordinator, via the agent portal.
//
// AGENT_SELF_SERVE_ENABLED       server-side switch; the only one that enforces anything.
// NEXT_PUBLIC_AGENT_SELF_SERVE_ENABLED   mirrors it so the sign-up form can show the choice.
// Both must be exactly "true" to turn the feature on.

export function agentSelfServeEnabled(): boolean {
  return process.env.AGENT_SELF_SERVE_ENABLED === 'true';
}

export const AGENT_SELF_SERVE_PUBLIC = process.env.NEXT_PUBLIC_AGENT_SELF_SERVE_ENABLED === 'true';

export const AGENT_SELF_SERVE_OFF_MESSAGE =
  'Agent accounts are not open yet. If your coordinator uses Relay, ask them to add you to a deal and you will get a free agent login.';
