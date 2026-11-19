import { describe, expect, it } from 'vitest';
import { BROKERAGE_LIMITS, agentHas, brokerageHas, brokerageSeatLimit, canInviteAnother, resolveAgentAccess, UNRELEASED_BROKERAGE_FEATURES } from '@/lib/tiers';

describe('brokerage tiers', () => {
  it('both tiers have the operating basics, including the agent-by-month CSV and required-document review', () => {
    for (const f of ['dashboard', 'agent_management', 'deal_visibility', 'file_review', 'team_messaging', 'reporting_basic', 'multiple_administrators'] as const) {
      expect(brokerageHas('basic', f)).toBe(true);
      expect(brokerageHas('pro', f)).toBe(true);
    }
  });
  it('Pro adds operational control: advanced compliance templates, reporting, analytics and permissions', () => {
    for (const f of ['compliance_templates_advanced', 'reporting_advanced', 'advanced_analytics', 'advanced_permissions'] as const) {
      expect(brokerageHas('basic', f)).toBe(false);
      expect(brokerageHas('pro', f)).toBe(true);
    }
  });
  it('brokerage-wide checklist policies and wider commission oversight are on neither tier yet', () => {
    expect(UNRELEASED_BROKERAGE_FEATURES).toEqual(['checklist_policies', 'commission_oversight']);
    for (const f of UNRELEASED_BROKERAGE_FEATURES) {
      expect(brokerageHas('basic', f)).toBe(false);
      expect(brokerageHas('pro', f)).toBe(false);
    }
  });
  it('Basic has one required-document list and limited extra administrators; Pro has more of both', () => {
    expect(BROKERAGE_LIMITS.basic.requiredDocumentLists).toBe(1);
    expect(BROKERAGE_LIMITS.pro.requiredDocumentLists).toBeGreaterThan(1);
    expect(BROKERAGE_LIMITS.pro.extraAdministrators).toBeGreaterThan(BROKERAGE_LIMITS.basic.extraAdministrators);
  });
  it('seat limits: 10 and 25 included, extra seats on top, bad extras ignored', () => {
    expect(brokerageSeatLimit('basic')).toBe(10);
    expect(brokerageSeatLimit('pro')).toBe(25);
    expect(brokerageSeatLimit('basic', 4)).toBe(14);
    expect(brokerageSeatLimit('basic', -3)).toBe(10);
    expect(brokerageSeatLimit('basic', 1.5)).toBe(10);
  });
  it('pending invitations count toward the limit; an over-limit or lapsed brokerage cannot invite', () => {
    expect(canInviteAnother({ active: 8, pending: 1 }, 'basic')).toBe(true);
    expect(canInviteAnother({ active: 8, pending: 2 }, 'basic')).toBe(false);
    expect(canInviteAnother({ active: 12, pending: 0 }, 'basic')).toBe(false);
    expect(canInviteAnother({ active: 12, pending: 0 }, 'basic', 5)).toBe(true);
    expect(canInviteAnother({ active: 1, pending: 0 }, 'pro', 0, false)).toBe(false);
  });
});

describe('agent levels', () => {
  const none = { ownSubscription: false, adminGrant: false, brokerage: null, invitedByCoordinator: false };
  it('a coordinator-invited agent works on the deals they were added to and cannot create their own', () => {
    for (const f of ['deal_visibility', 'documents', 'key_dates', 'messaging'] as const) expect(agentHas('guest', f)).toBe(true);
    expect(agentHas('guest', 'own_deals')).toBe(false);
    expect(resolveAgentAccess({ ...none, invitedByCoordinator: true })).toEqual({ level: 'guest', source: 'coordinator_invite' });
  });
  it('an agent invited by a paying brokerage runs their own deals with no subscription of their own', () => {
    expect(resolveAgentAccess({ ...none, brokerage: { inGoodStanding: true } })).toEqual({ level: 'basic', source: 'brokerage' });
    expect(agentHas('basic', 'own_deals')).toBe(true);
    // Basic includes AI intake, follow-ups and using templates, but not saving custom templates or emails, and nothing automatic.
    for (const f of ['listings', 'ai_intake', 'follow_ups', 'template_use'] as const) expect(agentHas('basic', f)).toBe(true);
    for (const f of ['custom_templates', 'automation'] as const) expect(agentHas('basic', f)).toBe(false);
  });
  it('Brokerage Basic beats a coordinator invitation', () => {
    expect(resolveAgentAccess({ ...none, brokerage: { inGoodStanding: true }, invitedByCoordinator: true }).level).toBe('basic');
  });
  it('a lapsed brokerage grants nothing: back to guest if a coordinator invited them, else none', () => {
    expect(resolveAgentAccess({ ...none, brokerage: { inGoodStanding: false } })).toEqual({ level: 'none', source: null });
    expect(resolveAgentAccess({ ...none, brokerage: { inGoodStanding: false }, invitedByCoordinator: true })).toEqual({ level: 'guest', source: 'coordinator_invite' });
    expect(agentHas('none', 'documents')).toBe(false);
  });
  it('Agent Pro adds custom templates and emails and automation, and survives leaving the brokerage', () => {
    for (const f of ['own_deals', 'ai_intake', 'follow_ups', 'template_use', 'custom_templates', 'automation'] as const) expect(agentHas('pro', f)).toBe(true);
    expect(resolveAgentAccess({ ...none, ownSubscription: true, brokerage: { inGoodStanding: true } })).toEqual({ level: 'pro', source: 'own_subscription' });
    expect(resolveAgentAccess({ ...none, ownSubscription: true })).toEqual({ level: 'pro', source: 'own_subscription' });
    expect(resolveAgentAccess({ ...none, adminGrant: true })).toEqual({ level: 'pro', source: 'admin_grant' });
  });
});
