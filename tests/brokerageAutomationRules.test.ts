import { describe, expect, it } from 'vitest';
import { AUTOMATIONS, cleanParams, closingFlags, defaultParams, digestText, documentFlags, lateStepFlags, monthlyText, paramNumber, quietAgents, stalledFlags, type DealLite } from '@/lib/brokerageAutomationRules';

const deal = (o: Partial<DealLite> = {}): DealLite => ({ id: 'd1', tc_user_id: 'a1', property_address: '1 Main St', status: 'Contract Pending', closing_date: null, acceptance_date: null, updated_at: '2026-11-01T10:00:00Z', health: { overdueTasks: 0 }, ...o });

describe('brokerage automation settings', () => {
  it('keeps every number inside its range and drops unknown keys', () => {
    expect(cleanParams('stalled', { days: 500, escalateDays: -3, junk: 1 })).toEqual({ days: 30, escalateDays: 1 });
    expect(cleanParams('stalled', {})).toEqual(defaultParams('stalled'));
  });
  it('keeps the welcome message short and only for onboarding', () => {
    expect(String(cleanParams('onboarding', { message: 'x'.repeat(5000) }).message).length).toBe(1000);
    expect(cleanParams('digest', { message: 'hi' })).not.toHaveProperty('message');
  });
  it('falls back to the default for a missing or bad value', () => {
    expect(paramNumber('stalled', { days: 'abc' }, 'days')).toBe(5);
    expect(AUTOMATIONS.map((a) => a.kind)).toHaveLength(6);
  });
});

describe('what each rule flags', () => {
  it('flags only open deals that have been quiet long enough, and flags again after a change', () => {
    const quiet = deal();
    const flags = stalledFlags([quiet, deal({ id: 'd2', updated_at: '2026-11-14T00:00:00Z' }), deal({ id: 'd3', status: 'Closed' })], '2026-11-15', 5);
    expect(flags.map((f) => f.dealId)).toEqual(['d1']);
    const later = stalledFlags([deal({ updated_at: '2026-11-03T00:00:00Z' })], '2026-11-15', 5);
    expect(later[0].key).not.toBe(flags[0].key);
  });
  it('flags closings inside the window, today included, and not closed or later ones', () => {
    const f = closingFlags([deal({ closing_date: '2026-11-15' }), deal({ id: 'b', closing_date: '2026-11-22' }), deal({ id: 'c', closing_date: '2026-11-23' }), deal({ id: 'd', closing_date: '2026-11-16', status: 'Closed' })], '2026-11-15', 7);
    expect(f.map((x) => x.dealId)).toEqual(['d1', 'b']);
    expect(f[0].reason).toBe('Closes today');
  });
  it('flags an agent with more overdue steps than the limit, once per week', () => {
    const deals = [deal({ health: { overdueTasks: 4 } }), deal({ id: 'x', health: { overdueTasks: 3 } }), deal({ id: 'y', tc_user_id: 'a2', health: { overdueTasks: 9 }, status: 'Closed' })];
    expect(lateStepFlags(deals, '2026-11-15', 5)).toEqual([expect.objectContaining({ agentId: 'a1', late: 7 })]);
    expect(lateStepFlags(deals, '2026-11-15', 7)).toEqual([]);
  });
  it('flags a file missing documents and names what is missing', () => {
    const f = documentFlags([deal(), deal({ id: 'ok' })], new Map([['d1', ['Seller Disclosure', 'Lead Paint', 'IABS', 'Survey']]]));
    expect(f).toHaveLength(1);
    expect(f[0].reason).toBe('Missing Seller Disclosure, Lead Paint, IABS and 1 more');
  });
  it('finds agents with no open deals who have been quiet', () => {
    const deals = [deal({ tc_user_id: 'a1', status: 'Closed', updated_at: '2026-08-01T00:00:00Z' }), deal({ id: 'z', tc_user_id: 'a2', status: 'Closed', updated_at: '2026-11-10T00:00:00Z' }), deal({ id: 'w', tc_user_id: 'a3' })];
    expect(quietAgents(['a1', 'a2', 'a3', 'a4'], deals, '2026-11-15', 60)).toEqual(['a1']);
  });
});

describe('wording', () => {
  it('says nothing on a day with nothing to say', () => {
    expect(digestText({ needsAttention: [], closing: [], lateAgents: [], quiet: [], newDeals: [] })).toBeNull();
  });
  it('puts the count that needs the broker in the subject', () => {
    const d = digestText({ needsAttention: [{ address: '1 Main', agentName: 'Sam', reason: 'No change for 6 days' }], closing: [], lateAgents: [{ name: 'Sam', late: 3 }], quiet: [], newDeals: [] });
    expect(d?.subject).toBe('Your brokerage today: 2 things need you');
  });
  it('reports a month with and without missing commissions', () => {
    expect(monthlyText('October 2026', { closed: 2, volume: 900000, withoutCommission: [] }).paragraphs).toEqual(['October 2026: 2 deals closed, $900,000 in sales volume.', 'Every recent closing has a commission recorded.']);
  });
});

import { cleanWorkflow, describeWorkflow, workflowFlags, WORKFLOW_PRESETS } from '@/lib/brokerageAutomationRules';
import { allowedRoles, roleAllows } from '@/lib/brokerageAdmins';

describe('custom workflows', () => {
  const agents = new Set(['a1', 'a2']);
  it('needs a name and someone to tell', () => {
    expect(cleanWorkflow({ trigger: 'quiet' }, agents)).toEqual({ ok: false, error: 'Give the workflow a name.' });
    expect(cleanWorkflow({ name: 'x', trigger: 'nope' }, agents).ok).toBe(false);
    expect(cleanWorkflow({ name: 'x', trigger: 'quiet', notifyAgent: false, notifyOwner: 'never' }, agents)).toEqual({ ok: false, error: 'Choose someone to tell: the agent, you, or both.' });
  });
  it('keeps numbers in range and only this brokerage’s agents', () => {
    const r = cleanWorkflow({ name: ' Quiet ', trigger: 'quiet', amount: 999, escalateDays: 0, agentIds: ['a1', 'stranger'], dealTypes: ['Cash', 'Cash'] }, agents);
    expect(r.ok && r.value).toMatchObject({ name: 'Quiet', amount: 60, escalateDays: 1, agentIds: ['a1'], dealTypes: ['Cash'], enabled: true, notifyOwner: 'escalate' });
  });
  it('ignores the number for a trigger that has none', () => {
    const r = cleanWorkflow({ name: 'Docs', trigger: 'missing_docs', amount: 9 }, agents);
    expect(r.ok && r.value.amount).toBe(0);
  });
  it('describes a workflow in one line', () => {
    expect(describeWorkflow({ trigger: 'quiet', amount: 5, notifyAgent: true, notifyOwner: 'escalate', escalateDays: 2 })).toBe('A deal has had no activity for at least 5 days → tell the agent, then you after 2 more days if unresolved');
  });
  it('finds new and closed deals by recency, and deals with too many late steps', () => {
    const deals = [deal({ acceptance_date: '2026-11-14' }), deal({ id: 'old', acceptance_date: '2026-10-01' }), deal({ id: 'c', status: 'Closed', closing_date: '2026-11-14' }), deal({ id: 'l', health: { overdueTasks: 3 } })];
    const day = (d: DealLite) => String(d.closing_date).slice(0, 10);
    expect(workflowFlags('new_deal', 1, deals, '2026-11-15', new Map(), day).map((f) => f.dealId)).toEqual(['d1']);
    expect(workflowFlags('closed', 1, deals, '2026-11-15', new Map(), day).map((f) => f.dealId)).toEqual(['c']);
    expect(workflowFlags('late_steps', 2, deals, '2026-11-15', new Map(), day).map((f) => f.dealId)).toEqual(['l']);
  });
  it('every library preset is a valid workflow', () => {
    for (const p of WORKFLOW_PRESETS) expect(cleanWorkflow(p, agents).ok).toBe(true);
  });
});

describe('managing accounts', () => {
  it('may do everything the owner does except plan and billing, which no administrator role includes', () => {
    expect(roleAllows('managing', 'full')).toBe(true);
    expect(roleAllows('manager', 'full')).toBe(false);
    expect(roleAllows('reviewer', 'full')).toBe(false);
  });
  it('is available on Basic as well as Pro', () => {
    expect(allowedRoles('basic')).toEqual(['manager', 'managing']);
    expect(allowedRoles('pro')).toContain('managing');
  });
});
