import { describe, expect, it } from 'vitest';
import { commissionNudges, daysBetween, type NudgeCommission, type NudgeDeal } from '@/lib/commissionNudgeRules';

const TODAY = '2026-11-10';
const deal = (o: Partial<NudgeDeal> & { id: string }): NudgeDeal => ({ address: '1 Main St', status: 'Contract Pending', closingDate: null, updatedAt: '2026-11-01T00:00:00Z', agentId: 'agent', ...o });
const comm = (o: Partial<NudgeCommission> & { id: string; transactionId: string }): NudgeCommission => ({ statementNumber: 'COMM-0001', status: 'change_requested', changeNote: null, ownerId: 'owner', agentId: 'agent', proposedAt: '2026-11-01T00:00:00Z', acceptedAt: null, ...o });
const run = (deals: NudgeDeal[], commissions: NudgeCommission[], ownerOf: (a: string) => string | null = () => 'owner') => commissionNudges({ deals, commissions, ownerOf, today: TODAY });

describe('daysBetween', () => {
  it('counts whole days between dates, ignoring the time', () => {
    expect(daysBetween('2026-11-01T23:59:00Z', '2026-11-03')).toBe(2);
    expect(daysBetween('2026-11-10', '2026-11-10')).toBe(0);
  });
});

describe('pending approval', () => {
  it('nudges the owner once an agent’s invoice has waited two days', () => {
    const n = run([deal({ id: 'd1' })], [comm({ id: 'c1', transactionId: 'd1', proposedAt: '2026-11-08T00:00:00Z' })]);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ recipientId: 'owner', transactionId: 'd1', repeatDays: 3 });
    expect(n[0].title).toMatch(/waited 2 days for your approval/);
  });
  it('leaves a fresh invoice, a real change request and a voided one alone', () => {
    expect(run([deal({ id: 'd1' })], [comm({ id: 'c1', transactionId: 'd1', proposedAt: '2026-11-09T00:00:00Z' })])).toEqual([]);
    expect(run([deal({ id: 'd1' })], [comm({ id: 'c1', transactionId: 'd1', changeNote: 'Make it 85%' })])).toEqual([]);
    expect(run([deal({ id: 'd1' })], [comm({ id: 'c1', transactionId: 'd1', status: 'void' })]).filter((n) => /approval/.test(n.title))).toEqual([]);
  });
  it('does not nudge a brokerage the agent has left', () => {
    expect(run([deal({ id: 'd1' })], [comm({ id: 'c1', transactionId: 'd1' })], () => null)).toEqual([]);
  });
});

describe('closing and closed deals with no invoice', () => {
  it('reminds the agent in the last week before closing, once', () => {
    const n = run([deal({ id: 'd1', closingDate: '2026-11-13' })], []);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ recipientId: 'agent', repeatDays: 30 });
    expect(n[0].title).toMatch(/Closing in 3 days/);
    expect(run([deal({ id: 'd1', closingDate: '2026-11-20' })], [])).toEqual([]);
    expect(run([deal({ id: 'd1', closingDate: '2026-11-13' })], [comm({ id: 'c1', transactionId: 'd1', proposedAt: '2026-11-10T00:00:00Z' })])).toEqual([]);
  });
  it('says closing today, and nothing for deals outside a brokerage', () => {
    expect(run([deal({ id: 'd1', closingDate: TODAY })], [])[0].title).toMatch(/Closing today/);
    expect(run([deal({ id: 'd1', closingDate: TODAY })], [], () => null)).toEqual([]);
  });
  it('chases both sides two days after a deal closed with no invoice', () => {
    const n = run([deal({ id: 'd1', status: 'Closed', closingDate: '2026-11-07' })], []);
    expect(n.map((x) => x.recipientId).sort()).toEqual(['agent', 'owner']);
    expect(n.every((x) => x.repeatDays === 7)).toBe(true);
    expect(run([deal({ id: 'd1', status: 'Closed', closingDate: '2026-11-09' })], [])).toEqual([]);
  });
  it('falls back to when the deal was last updated if the closing date is in the future', () => {
    expect(run([deal({ id: 'd1', status: 'Closed', closingDate: '2026-12-01', updatedAt: '2026-11-01T00:00:00Z' })], [])).toHaveLength(2);
  });
});

describe('approved but unpaid', () => {
  it('nudges the owner a week after approval on a closed deal, not before and not on an open deal', () => {
    const approved = (at: string) => comm({ id: 'c1', transactionId: 'd1', status: 'accepted', acceptedAt: at });
    expect(run([deal({ id: 'd1', status: 'Closed' })], [approved('2026-11-03T00:00:00Z')])).toHaveLength(1);
    expect(run([deal({ id: 'd1', status: 'Closed' })], [approved('2026-11-05T00:00:00Z')])).toEqual([]);
    expect(run([deal({ id: 'd1' })], [approved('2026-11-01T00:00:00Z')])).toEqual([]);
  });
});
