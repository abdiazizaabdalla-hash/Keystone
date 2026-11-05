import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {}, supabaseServer: {} }));

import { getEntitlements } from '@/lib/entitlements';
import { hasBrokerageAccess, mayGetBrokerageAccess, withBrokerageAccess } from '@/lib/brokerageAccessMeta';
import { assertTrialActive } from '@/lib/trial';

const on = { brokerage: true, agentWorkspace: true };
const u = (app_metadata: Record<string, unknown>) => ({ id: 'u1', created_at: '2026-10-01T00:00:00Z', app_metadata });

beforeEach(() => vi.stubEnv('RELAY_FEATURES', 'agent_workspace,brokerage'));
afterEach(() => vi.unstubAllEnvs());

describe('who may get Basic from a brokerage', () => {
  it('only an agent with no workspace of their own, with both features on', () => {
    expect(mayGetBrokerageAccess(u({ role: 'agent' }), on)).toBe(true);
    expect(mayGetBrokerageAccess(u({ role: 'agent', agent_workspace: true }), on)).toBe(false); // already Pro
    expect(mayGetBrokerageAccess(u({ plan: 'team' }), on)).toBe(false); // a coordinator or broker is not an agent
    expect(mayGetBrokerageAccess(u({ role: 'agent', is_admin: true }), on)).toBe(false);
    expect(mayGetBrokerageAccess(u({ role: 'agent' }), { brokerage: false, agentWorkspace: true })).toBe(false);
    expect(mayGetBrokerageAccess(u({ role: 'agent' }), { brokerage: true, agentWorkspace: false })).toBe(false);
    expect(mayGetBrokerageAccess(null, on)).toBe(false);
  });
});

describe('the three agent levels', () => {
  it('a free portal login is Guest and cannot own a workspace', () => {
    expect(getEntitlements(u({ role: 'agent' }))).toMatchObject({ kind: 'collaborator', agentLevel: 'guest', canOwnWorkspace: false });
  });

  it('an agent a brokerage provides for is Basic and owns their own workspace', () => {
    const basic = withBrokerageAccess(u({ role: 'agent' }));
    expect(hasBrokerageAccess(basic)).toBe(true);
    expect(getEntitlements(basic)).toMatchObject({ kind: 'agent_workspace', agentLevel: 'basic', canOwnWorkspace: true, isCollaborator: false });
  });

  it('an admin-granted workspace is Pro, and the brokerage never downgrades it', () => {
    expect(getEntitlements(u({ role: 'agent', agent_workspace: true }))).toMatchObject({ kind: 'agent_workspace', agentLevel: 'pro' });
  });

  it('coordinators and admins are not agents', () => {
    expect(getEntitlements(u({ plan: 'pro' })).agentLevel).toBeNull();
    expect(getEntitlements(u({ is_admin: true })).agentLevel).toBeNull();
  });

  it('Basic is only the in-request copy: it does not write anything and cannot be claimed by editing a profile', () => {
    const original = u({ role: 'agent' });
    const copy = withBrokerageAccess({ ...original, app_metadata: { ...original.app_metadata } });
    expect(original.app_metadata).toEqual({ role: 'agent' });
    expect(copy.app_metadata.agent_workspace).toBe(true);
    const selfEdited = { app_metadata: { role: 'agent' }, user_metadata: { agent_access_source: 'brokerage', agent_workspace: true } };
    expect(getEntitlements(selfEdited)).toMatchObject({ kind: 'collaborator', agentLevel: 'guest' });
  });

  it('Basic needs the agent_workspace feature, like any workspace', () => {
    vi.stubEnv('RELAY_FEATURES', 'brokerage');
    expect(getEntitlements(withBrokerageAccess(u({ role: 'agent' }))).kind).toBe('collaborator');
  });
});

describe('Basic is free: the Starter trial does not apply', () => {
  it('a Basic agent whose trial date has passed is not blocked', async () => {
    const expired = { trial_ends_at: '2020-01-01T00:00:00Z' };
    await expect(assertTrialActive({ ...withBrokerageAccess(u({ role: 'agent', ...expired })) } as never)).resolves.toBeUndefined();
  });
});
