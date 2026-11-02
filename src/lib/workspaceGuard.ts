import { AuthError } from './auth';
import { type WithAppMetadata } from './privileged';
import { getEntitlements } from './entitlements';

export const COLLABORATOR_BLOCKED_MESSAGE =
  'Agent portal accounts can work on deals a coordinator has added them to, but cannot create their own. Ask your coordinator to add you to a deal.';

/**
 * A free agent portal login (an invited collaborator) works on deals a paying
 * coordinator shared with them. It does not own a workspace, so it must not
 * reach routes that create or change a coordinator's own work (templates,
 * teams, calendar sync, signing, invitations).
 *
 * Call this right after getUserFromRequest on every such route. Routes that
 * guard with assertTrialActive already get this check.
 */
export function assertNotCollaborator(user: WithAppMetadata): void {
  if (!getEntitlements(user).canOwnWorkspace) throw new AuthError(COLLABORATOR_BLOCKED_MESSAGE, 403);
}
