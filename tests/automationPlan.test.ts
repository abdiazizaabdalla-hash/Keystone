import { describe, it, expect } from 'vitest';
import { planIncludesAutomation, userMayAutomate } from '@/lib/automation/plan';

describe('automation plan gate', () => {
  it('includes Pro, Team and Brokerage only', () => {
    expect(planIncludesAutomation('pro')).toBe(true);
    expect(planIncludesAutomation('team')).toBe(true);
    expect(planIncludesAutomation('brokerage')).toBe(true);
    expect(planIncludesAutomation('starter')).toBe(false);
    expect(planIncludesAutomation(undefined)).toBe(false);
  });
  it('coordinators follow their plan; a missing plan is Starter', () => {
    expect(userMayAutomate({ app_metadata: { plan: 'pro' } })).toBe(true);
    expect(userMayAutomate({ app_metadata: { plan: 'team' } })).toBe(true);
    expect(userMayAutomate({ app_metadata: { plan: 'starter' } })).toBe(false);
    expect(userMayAutomate({ app_metadata: {} })).toBe(false);
  });
  it('admins always; free agent logins never', () => {
    expect(userMayAutomate({ app_metadata: { is_admin: true } })).toBe(true);
    expect(userMayAutomate({ app_metadata: { role: 'agent', plan: 'pro' } })).toBe(false);
  });
});
