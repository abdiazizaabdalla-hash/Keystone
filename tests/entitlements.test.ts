import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// workspaceGuard pulls in the auth module, which opens a database client on import.
vi.mock('@/lib/supabase', () => ({ supabase: {}, supabaseServer: {} }));

import { getEntitlements, hasAgentWorkspace } from '@/lib/entitlements';
import { assertNotCollaborator } from '@/lib/workspaceGuard';

const u = (app_metadata?: Record<string, unknown> | null) => ({ app_metadata });

beforeEach(() => {
  vi.stubEnv('RELAY_FEATURES', 'agent_workspace');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('account kinds', () => {
  it('treats a user with no metadata as a coordinator who can own a workspace', () => {
    for (const user of [undefined, null, u(), u(null), u({}), u({ plan: 'pro' })]) {
      const e = getEntitlements(user);
      expect(e.kind).toBe('coordinator');
      expect(e.canOwnWorkspace).toBe(true);
      expect(e.isCollaborator).toBe(false);
    }
  });

  it('treats role "agent" as a free collaborator that owns no workspace', () => {
    const e = getEntitlements(u({ role: 'agent' }));
    expect(e).toMatchObject({ kind: 'collaborator', isCollaborator: true, canOwnWorkspace: false, canJoinSharedDeals: true });
  });

  it('lets an agent with the workspace grant own a workspace', () => {
    const e = getEntitlements(u({ role: 'agent', agent_workspace: true }));
    expect(e).toMatchObject({ kind: 'agent_workspace', isCollaborator: false, canOwnWorkspace: true });
  });

  it('ignores the workspace grant unless it is exactly true', () => {
    for (const v of ['true', 1, 'yes', null, false, {}]) {
      expect(hasAgentWorkspace(u({ role: 'agent', agent_workspace: v }))).toBe(false);
      expect(getEntitlements(u({ role: 'agent', agent_workspace: v })).canOwnWorkspace).toBe(false);
    }
  });

  it('recognises a platform admin', () => {
    expect(getEntitlements(u({ is_admin: true })).kind).toBe('admin');
    expect(getEntitlements(u({ is_admin: 'true' })).kind).toBe('coordinator');
  });

  it('reads server-only metadata, never the profile a person can edit themselves', () => {
    const selfEdited = { app_metadata: {}, user_metadata: { role: 'agent', agent_workspace: true, is_admin: true, plan: 'team' } };
    expect(getEntitlements(selfEdited).kind).toBe('coordinator');
    const collab = { app_metadata: { role: 'agent' }, user_metadata: { agent_workspace: true } };
    expect(getEntitlements(collab).canOwnWorkspace).toBe(false);
  });
});

describe('the workspace grant counts only while the feature is switched on', () => {
  it('is ignored in an environment where agent_workspace is off (production)', () => {
    for (const flags of ['', 'automation', 'agent_workspaces']) {
      vi.stubEnv('RELAY_FEATURES', flags);
      const e = getEntitlements(u({ role: 'agent', agent_workspace: true }));
      expect(e.kind).toBe('collaborator');
      expect(e.canOwnWorkspace).toBe(false);
    }
  });
});

describe('assertNotCollaborator follows the entitlement', () => {
  it('refuses a free collaborator', () => {
    expect(() => assertNotCollaborator(u({ role: 'agent' }))).toThrow(/cannot create their own/);
  });
  it('allows coordinators, admins and agents with a workspace', () => {
    expect(() => assertNotCollaborator(u({}))).not.toThrow();
    expect(() => assertNotCollaborator(u({ is_admin: true }))).not.toThrow();
    expect(() => assertNotCollaborator(u({ role: 'agent', agent_workspace: true }))).not.toThrow();
  });
});
