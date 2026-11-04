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

describe('closing and closed deals before the actual commission is confirmed', () => {
  const estimate = (transactionId: string, o: Partial<NudgeCommission> = {}) => comm({ id: `c-${transactionId}`, transactionId, status: 'estimate', ...o });
  it('says nothing about commission before the deal has closed, even in the last week', () => {
    expect(run([deal({ id: 'd1', closingDate: '2026-11-13' })], [estimate('d1')])).toEqual([]);
    expect(run([deal({ id: 'd1', closingDate: TODAY })], [estimate('d1')])).toEqual([]);
  });
  it('never nudges an agent to invoice anyone', () => {
    expect(run([deal({ id: 'd1', closingDate: '2026-11-13' })], []).filter((x) => x.recipientId === 'agent')).toEqual([]);
    expect(run([deal({ id: 'd1', status: 'Closed', closingDate: '2026-11-07' })], [estimate('d1')]).filter((x) => x.recipientId === 'agent')).toEqual([]);
    expect(run([deal({ id: 'd1', status: 'Closed', closingDate: '2026-11-07' })], []).filter((x) => x.recipientId === 'agent')).toEqual([]);
  });
  it('says nothing for closed deals outside a brokerage', () => {
    expect(run([deal({ id: 'd1', status: 'Closed', closingDate: '2026-11-07' })], [estimate('d1')], () => null)).toEqual([]);
  });
  it('chases the owner two days after a closed deal is still an estimate', () => {
    const n = run([deal({ id: 'd1', status: 'Closed', closingDate: '2026-11-07' })], [estimate('d1')]);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ recipientId: 'owner', repeatDays: 7 });
    expect(n[0].title).toMatch(/Confirm the actual commission/);
    expect(run([deal({ id: 'd1', status: 'Closed', closingDate: '2026-11-09' })], [estimate('d1')])).toEqual([]);
  });
  it('asks the owner to set terms when a closed deal has no statement at all', () => {
    const n = run([deal({ id: 'd1', status: 'Closed', closingDate: '2026-11-07' })], []);
    expect(n).toHaveLength(1);
    expect(n[0].recipientId).toBe('owner');
    expect(n[0].title).toMatch(/Set the agent.s commission terms/);
  });
  it('is quiet once the owner has confirmed the commission', () => {
    expect(run([deal({ id: 'd1', status: 'Closed', closingDate: '2026-11-07' })], [comm({ id: 'c1', transactionId: 'd1', status: 'proposed' })])).toEqual([]);
  });
  it('falls back to when the deal was last updated if the closing date is in the future', () => {
    expect(run([deal({ id: 'd1', status: 'Closed', closingDate: '2026-12-01', updatedAt: '2026-11-01T00:00:00Z' })], [estimate('d1')])).toHaveLength(1);
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
