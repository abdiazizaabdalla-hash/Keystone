import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAccountType } from '@/lib/accountType';

describe('account type is read from server-controlled metadata only', () => {
  it('defaults to a coordinator', () => {
    expect(getAccountType(undefined)).toBe('tc');
    expect(getAccountType(null)).toBe('tc');
    expect(getAccountType({})).toBe('tc');
  });

  it('is an agent only when app_metadata says so', () => {
    expect(getAccountType({ account_type: 'agent' })).toBe('agent');
    expect(getAccountType({ account_type: 'admin' })).toBe('tc');
  });

  it('does not take a self-assigned user_metadata tag as an agent', () => {
    // /api/auth/me passes user.app_metadata, so a tag a person writes to their own
    // user_metadata never reaches this function.
    const user = { user_metadata: { account_type: 'agent' }, app_metadata: {} as Record<string, unknown> };
    expect(getAccountType(user.app_metadata)).toBe('tc');
  });
});

describe('agent self-serve switch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off unless explicitly "true"', async () => {
    const { agentSelfServeEnabled } = await import('@/lib/agentSelfServe');
    vi.stubEnv('AGENT_SELF_SERVE_ENABLED', '');
    expect(agentSelfServeEnabled()).toBe(false);
    vi.stubEnv('AGENT_SELF_SERVE_ENABLED', '1');
    expect(agentSelfServeEnabled()).toBe(false);
    vi.stubEnv('AGENT_SELF_SERVE_ENABLED', 'TRUE');
    expect(agentSelfServeEnabled()).toBe(false);
    vi.stubEnv('AGENT_SELF_SERVE_ENABLED', 'true');
    expect(agentSelfServeEnabled()).toBe(true);
  });
});
