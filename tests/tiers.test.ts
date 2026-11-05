import { describe, expect, it } from 'vitest';
import { agentHas, brokerageHas, brokerageInGoodStanding, brokerageSeatLimit, canInviteAnother, resolveAgentAccess } from '@/lib/tiers';

describe('brokerage tiers', () => {
  it('Basic has the essentials, Pro adds advanced compliance, reporting, admin permissions and checklists', () => {
    for (const f of ['agent_management', 'deal_visibility', 'file_review', 'compliance_tracking'] as const) {
      expect(brokerageHas('basic', f)).toBe(true);
      expect(brokerageHas('pro', f)).toBe(true);
    }
    for (const f of ['advanced_compliance', 'reporting', 'admin_permissions', 'checklist_management'] as const) {
      expect(brokerageHas('basic', f)).toBe(false);
      expect(brokerageHas('pro', f)).toBe(true);
    }
  });
  it('seat limits: 10 and 25 included, extra seats on top, bad extras ignored', () => {
    expect(brokerageSeatLimit('basic')).toBe(10);
    expect(brokerageSeatLimit('pro')).toBe(25);
    expect(brokerageSeatLimit('basic', 4)).toBe(14);
    expect(brokerageSeatLimit('basic', -3)).toBe(10);
    expect(brokerageSeatLimit('basic', 1.5)).toBe(10);
  });
  it('pending invitations count toward the limit, and an over-limit brokerage cannot invite', () => {
    expect(canInviteAnother({ active: 8, pending: 1 }, 'basic')).toBe(true);
    expect(canInviteAnother({ active: 8, pending: 2 }, 'basic')).toBe(false);
    expect(canInviteAnother({ active: 12, pending: 0 }, 'basic')).toBe(false);
    expect(canInviteAnother({ active: 12, pending: 0 }, 'basic', 5)).toBe(true);
  });
  it('good standing: pilot until its end date, admin always, subscription only while active', () => {
    expect(brokerageInGoodStanding({ source: 'pilot' }, '2026-11-05')).toBe(true);
    expect(brokerageInGoodStanding({ source: 'pilot', pilotEndsOn: '2026-12-01' }, '2026-11-05')).toBe(true);
    expect(brokerageInGoodStanding({ source: 'pilot', pilotEndsOn: '2026-11-01' }, '2026-11-05')).toBe(false);
    expect(brokerageInGoodStanding({ source: 'admin' }, '2026-11-05')).toBe(true);
    expect(brokerageInGoodStanding({ source: 'subscription', subscriptionActive: true }, '2026-11-05')).toBe(true);
    expect(brokerageInGoodStanding({ source: 'subscription' }, '2026-11-05')).toBe(false);
  });
});

describe('agent tiers', () => {
  const none = { ownSubscription: false, adminGrant: false, brokerage: null, invitedByCoordinator: false };
  it('Basic is transactions, dates, documents and messaging; Pro adds CRM, follow-ups, templates and workflow extras', () => {
    for (const f of ['deal_visibility', 'documents', 'key_dates', 'messaging'] as const) expect(agentHas('basic', f)).toBe(true);
    for (const f of ['crm_contacts', 'follow_ups', 'templates', 'workflow_extras'] as const) {
      expect(agentHas('basic', f)).toBe(false);
      expect(agentHas('pro', f)).toBe(true);
    }
  });
  it('an agent invited by a paying brokerage gets Basic with no subscription of their own', () => {
    expect(resolveAgentAccess({ ...none, brokerage: { inGoodStanding: true } })).toEqual({ tier: 'basic', source: 'brokerage' });
  });
  it('a lapsed brokerage grants nothing, but a coordinator invitation still gives Basic', () => {
    expect(resolveAgentAccess({ ...none, brokerage: { inGoodStanding: false } })).toEqual({ tier: 'basic', source: null });
    expect(resolveAgentAccess({ ...none, brokerage: { inGoodStanding: false }, invitedByCoordinator: true })).toEqual({ tier: 'basic', source: 'coordinator_invite' });
  });
  it('Agent Pro is an optional upgrade that survives leaving or losing the brokerage', () => {
    expect(resolveAgentAccess({ ...none, ownSubscription: true, brokerage: { inGoodStanding: true } })).toEqual({ tier: 'pro', source: 'own_subscription' });
    expect(resolveAgentAccess({ ...none, ownSubscription: true })).toEqual({ tier: 'pro', source: 'own_subscription' });
    expect(resolveAgentAccess({ ...none, adminGrant: true })).toEqual({ tier: 'pro', source: 'admin_grant' });
  });
});
