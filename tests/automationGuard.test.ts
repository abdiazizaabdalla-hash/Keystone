import { describe, expect, it } from 'vitest';
import { evaluateGuard, inQuietHours, localHour, type GuardContext } from '@/lib/automation/guard';

const noon = new Date('2026-11-09T18:00:00Z'); // 12:00 in Chicago (CST, UTC-6)
const base: GuardContext = {
  featureOn: true,
  killSwitch: false,
  entitled: true,
  mode: 'draft',
  allowedRecipients: ['buyer@x.com', 'title@y.com'],
  sentToday: 0,
  dailySendCap: 5,
  quietHours: { startHour: 21, endHour: 7, timeZone: 'America/Chicago' },
  now: noon,
};
const email = (to: string[], extra = {}) => ({ kind: 'send_deal_email', recipients: to, ...extra });

describe('automation guard: refusals', () => {
  it('refuses everything when the feature is off', () => {
    expect(evaluateGuard({ kind: 'create_task' }, { ...base, featureOn: false })).toEqual({ outcome: 'refuse', reason: 'feature_off' });
  });

  it('the kill switch stops every action, even internal ones', () => {
    expect(evaluateGuard({ kind: 'create_task' }, { ...base, killSwitch: true })).toMatchObject({ reason: 'kill_switch' });
    expect(evaluateGuard(email(['buyer@x.com']), { ...base, killSwitch: true, mode: 'auto' })).toMatchObject({ reason: 'kill_switch' });
  });

  it('refuses a free collaborator or an expired trial (not entitled)', () => {
    expect(evaluateGuard({ kind: 'create_task' }, { ...base, entitled: false })).toMatchObject({ reason: 'not_entitled' });
  });

  it('refuses every restricted action in every mode', () => {
    for (const mode of ['draft', 'auto'] as const) {
      for (const kind of ['sign_document', 'waive_contingency', 'change_contract_terms', 'change_commission', 'create_invoice', 'record_payment', 'delete_deal', 'change_permissions', 'choose_between_conflicting_dates']) {
        expect(evaluateGuard({ kind }, { ...base, mode })).toMatchObject({ outcome: 'refuse', reason: 'restricted_action' });
      }
    }
  });

  it('refuses an action that is not in the catalog', () => {
    expect(evaluateGuard({ kind: 'forward_everything' }, base)).toMatchObject({ reason: 'unknown_action' });
  });

  it('mode off refuses', () => {
    expect(evaluateGuard({ kind: 'create_task' }, { ...base, mode: 'off' })).toMatchObject({ reason: 'mode_off' });
  });

  it('refuses a recipient who is not on the deal, matching case-insensitively', () => {
    expect(evaluateGuard(email(['stranger@z.com']), base)).toMatchObject({ reason: 'recipient_not_on_deal', detail: 'stranger@z.com' });
    expect(evaluateGuard(email(['buyer@x.com', 'stranger@z.com']), base)).toMatchObject({ reason: 'recipient_not_on_deal' });
    expect(evaluateGuard(email([' BUYER@X.COM ']), base)).toMatchObject({ outcome: 'allow' });
  });

  it('refuses an email with no recipients', () => {
    expect(evaluateGuard(email([]), base)).toMatchObject({ reason: 'no_recipients' });
  });

  it('refuses when the daily cap would be passed, counting this send', () => {
    expect(evaluateGuard(email(['buyer@x.com']), { ...base, sentToday: 4 })).toMatchObject({ outcome: 'allow' });
    expect(evaluateGuard(email(['buyer@x.com', 'title@y.com']), { ...base, sentToday: 4 })).toMatchObject({ reason: 'over_daily_cap' });
    expect(evaluateGuard(email(['buyer@x.com']), { ...base, sentToday: 5 })).toMatchObject({ reason: 'over_daily_cap' });
  });
});

describe('automation guard: quiet hours (fake clock)', () => {
  const night = new Date('2026-11-10T04:30:00Z'); // 22:30 Chicago
  const early = new Date('2026-11-10T11:00:00Z'); // 05:00 Chicago
  it('computes local hour in the account time zone', () => {
    expect(localHour(noon, 'America/Chicago')).toBe(12);
    expect(localHour(night, 'America/Chicago')).toBe(22);
  });
  it('treats a window that crosses midnight correctly', () => {
    const q = { startHour: 21, endHour: 7, timeZone: 'America/Chicago' };
    expect(inQuietHours(night, q)).toBe(true);
    expect(inQuietHours(early, q)).toBe(true);
    expect(inQuietHours(noon, q)).toBe(false);
  });
  it('holds an Auto send at night (nobody is deciding), but not an internal task', () => {
    expect(evaluateGuard(email(['buyer@x.com'], { fromApprovedTemplate: true }), { ...base, mode: 'auto', now: night })).toEqual({ outcome: 'defer', reason: 'quiet_hours' });
    expect(evaluateGuard({ kind: 'create_task' }, { ...base, now: night })).toMatchObject({ outcome: 'allow', requiresApproval: false });
  });
  it('never holds the question: a draft is put to the owner at once, night or day', () => {
    expect(evaluateGuard(email(['buyer@x.com'], { fromApprovedTemplate: true }), { ...base, mode: 'draft', now: night })).toEqual({ outcome: 'allow', requiresApproval: true, approvalReason: 'draft_mode' });
    expect(evaluateGuard(email(['buyer@x.com']), { ...base, mode: 'auto', now: night })).toEqual({ outcome: 'allow', requiresApproval: true, approvalReason: 'not_template' });
  });
  it('an email the owner has just approved goes now, even at night', () => {
    expect(evaluateGuard(email(['buyer@x.com'], { approvedByPerson: true }), { ...base, now: night })).toMatchObject({ outcome: 'allow' });
    expect(evaluateGuard(email(['buyer@x.com'], { approvedByPerson: true, fromApprovedTemplate: true }), { ...base, mode: 'auto', now: night })).toMatchObject({ outcome: 'allow' });
  });
  it('approval does not skip the other rules (cap, strangers) at night', () => {
    expect(evaluateGuard(email(['stranger@x.com'], { approvedByPerson: true }), { ...base, now: night })).toMatchObject({ reason: 'recipient_not_on_deal' });
    expect(evaluateGuard(email(['buyer@x.com'], { approvedByPerson: true }), { ...base, sentToday: 5, now: night })).toMatchObject({ reason: 'over_daily_cap' });
  });
  it('a bad time zone falls back instead of throwing', () => {
    expect(() => localHour(noon, 'Not/AZone')).not.toThrow();
  });
});

describe('automation guard: approval rules', () => {
  it('Draft mode: every external send needs approval', () => {
    expect(evaluateGuard(email(['buyer@x.com'], { fromApprovedTemplate: true }), base)).toEqual({ outcome: 'allow', requiresApproval: true, approvalReason: 'draft_mode' });
  });
  it('Auto mode: only an approved template reminder goes without approval', () => {
    const auto = { ...base, mode: 'auto' as const };
    expect(evaluateGuard(email(['buyer@x.com'], { fromApprovedTemplate: true }), auto)).toEqual({ outcome: 'allow', requiresApproval: false });
    expect(evaluateGuard(email(['buyer@x.com']), auto)).toEqual({ outcome: 'allow', requiresApproval: true, approvalReason: 'not_template' });
  });
  it('changing contract dates always needs approval, even in Auto', () => {
    expect(evaluateGuard({ kind: 'set_date' }, { ...base, mode: 'auto' })).toEqual({ outcome: 'allow', requiresApproval: true, approvalReason: 'contract_dates' });
  });
  it('suggestions (tick a step, file a document) always need a person, even in Auto', () => {
    for (const kind of ['suggest_tick', 'classify_document', 'file_document']) {
      expect(evaluateGuard({ kind }, { ...base, mode: 'auto' })).toEqual({ outcome: 'allow', requiresApproval: true, approvalReason: 'suggestion' });
    }
  });
  it('internal low-risk actions run without approval', () => {
    for (const kind of ['create_task', 'add_note', 'notify_user', 'send_briefing']) {
      expect(evaluateGuard({ kind }, base)).toEqual({ outcome: 'allow', requiresApproval: false });
    }
  });
});
