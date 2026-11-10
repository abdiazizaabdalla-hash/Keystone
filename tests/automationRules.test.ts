import { describe, expect, it } from 'vitest';
import { buildBriefing, daysBetween, evaluateDealRules, localDay, peopleWaitedOn, type DealSnapshot } from '@/lib/automation/rules';

const deal = (over: Partial<DealSnapshot> = {}): DealSnapshot => ({
  id: 'd1', address: '12 Oak St', fileNumber: 'F-1', status: 'Contract Pending', acceptanceDate: '2026-11-01', closingDate: '2026-12-15',
  tasks: [], documentTypes: ['Purchase Contract'], followUpDays: 3,
  people: [{ name: 'Tina', email: 'Tina@Title.com', role: 'Title company', category: 'Title' }, { name: 'Lee', email: 'lee@lender.com', role: 'Lender', category: 'Lender' }, { name: 'No Mail', email: null, role: 'Inspector', category: 'Inspector' }],
  ...over,
});
const task = (o: Partial<DealSnapshot['tasks'][number]> = {}) => ({ id: 't1', name: 'Title commitment', completed: false, dueDate: null, waitingOn: null, waitingSince: null, ...o });

describe('dates', () => {
  it('counts whole days and uses the owner time zone', () => {
    expect(daysBetween('2026-11-09', '2026-11-12')).toBe(3);
    expect(daysBetween('2026-11-12', '2026-11-09')).toBe(-3);
    expect(localDay(new Date('2026-11-10T03:30:00Z'), 'America/Chicago')).toBe('2026-11-09'); // still the 9th in Texas
    expect(localDay(new Date('2026-11-10T03:30:00Z'), 'Not/AZone')).toBe('2026-11-10');
  });
});

describe('follow-up timers', () => {
  const waiting = (since: string) => deal({ tasks: [task({ waitingOn: 'Title company', waitingSince: since })] });

  it('does nothing before the follow-up interval', () => {
    expect(evaluateDealRules(waiting('2026-11-08'), '2026-11-10')).toEqual([]); // 2 days, interval 3
  });
  it('drafts a reminder to the matching person once the interval passes, as a routine template', () => {
    const [p] = evaluateDealRules(waiting('2026-11-06'), '2026-11-09');
    expect(p).toMatchObject({ kind: 'send_step_email', fromApprovedTemplate: true, idempotencyKey: 'followup:t1:2026-11-06:1' });
    expect(p.inputs.to).toEqual(['tina@title.com']);
    expect(String(p.inputs.subject)).toContain('Title commitment');
  });
  it('repeats every interval with a new key, the same day proposes the same key, and stops after five chases', () => {
    expect(evaluateDealRules(waiting('2026-11-01'), '2026-11-09')[0].idempotencyKey).toBe('followup:t1:2026-11-01:2');
    expect(evaluateDealRules(waiting('2026-11-01'), '2026-11-09')[0].idempotencyKey).toBe(evaluateDealRules(waiting('2026-11-01'), '2026-11-09')[0].idempotencyKey);
    expect(evaluateDealRules(waiting('2026-10-01'), '2026-11-09')).toEqual([]); // 39 days = 13 intervals
  });
  it('only tells you when nobody on the deal matches or the match has no email', () => {
    const d = deal({ tasks: [task({ waitingOn: 'Surveyor', waitingSince: '2026-11-01' })] });
    const [p] = evaluateDealRules(d, '2026-11-09');
    expect(p.kind).toBe('notify_user');
    expect(peopleWaitedOn('Inspector', d.people)).toEqual([]);
  });
  it('ignores finished steps and closed deals', () => {
    expect(evaluateDealRules(deal({ tasks: [task({ completed: true, waitingOn: 'Title company', waitingSince: '2026-11-01' })] }), '2026-11-09')).toEqual([]);
    expect(evaluateDealRules({ ...waiting('2026-11-01'), status: 'Closed' }, '2026-11-09')).toEqual([]);
  });
});

describe('deadline guard', () => {
  it('flags overdue once and due-soon once, never completed steps', () => {
    const d = deal({ tasks: [task({ id: 'a', name: 'Earnest money', dueDate: '2026-11-07' }), task({ id: 'b', name: 'Option period', dueDate: '2026-11-10' }), task({ id: 'c', name: 'Survey', dueDate: '2026-11-30' }), task({ id: 'e', name: 'Done', completed: true, dueDate: '2026-11-01' })] });
    const keys = evaluateDealRules(d, '2026-11-09').map((p) => p.idempotencyKey);
    expect(keys).toContain('deadline:a:2026-11-07:overdue');
    expect(keys).toContain('deadline:b:2026-11-10:soon');
    expect(keys.some((k) => k.includes(':c:') || k.startsWith('deadline:c') || k.startsWith('deadline:e'))).toBe(false);
  });
  it('warns when closing is within a week and steps are still open', () => {
    const d = deal({ closingDate: '2026-11-13', tasks: [task({ dueDate: '2026-12-30' })] });
    expect(evaluateDealRules(d, '2026-11-09').map((p) => p.idempotencyKey)).toContain('closing-soon:d1:2026-11-13');
    expect(evaluateDealRules(deal({ closingDate: '2026-11-13', tasks: [] }), '2026-11-09').some((p) => p.idempotencyKey.startsWith('closing-soon'))).toBe(false);
  });
});

describe('missing documents', () => {
  it('flags a missing contract when closing is near or acceptance was 3+ days ago, once', () => {
    const none = deal({ documentTypes: [], closingDate: '2026-12-30', acceptanceDate: '2026-11-08' });
    expect(evaluateDealRules(none, '2026-11-09')).toEqual([]);
    expect(evaluateDealRules({ ...none, acceptanceDate: '2026-11-05' }, '2026-11-09')[0].idempotencyKey).toBe('missing-contract:d1');
    expect(evaluateDealRules({ ...none, closingDate: '2026-11-20' }, '2026-11-09')[0].idempotencyKey).toBe('missing-contract:d1');
  });
  it('is quiet when the contract is there', () => {
    expect(evaluateDealRules(deal({ closingDate: '2026-11-12' }), '2026-11-09').some((p) => p.idempotencyKey.startsWith('missing'))).toBe(false);
  });
});

describe('daily briefing', () => {
  it('lists what needs attention and the drafts waiting', () => {
    const b = buildBriefing('2026-11-09', [{ address: '12 Oak St', overdue: ['Earnest money'], dueToday: [], closingInDays: 3, openWaiting: ['Title company'] }], 2)!;
    expect(b.subject).toContain('2026-11-09');
    expect(b.message).toContain('2 drafts are waiting');
    expect(b.message).toContain('Overdue: Earnest money');
    expect(b.message).toContain('Closing in 3 days');
  });
  it('sends nothing when there is nothing to say', () => {
    expect(buildBriefing('2026-11-09', [{ address: 'x', overdue: [], dueToday: [], closingInDays: 40, openWaiting: [] }], 0)).toBeNull();
  });
});

import { findStalled, weekKey } from '@/lib/automation/rules';

describe('stalled deals', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  const d = (over: Partial<Parameters<typeof findStalled>[0][number]> = {}) => ({ address: '1 Main', status: 'Active', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z', lastEventAt: null, ...over });
  it('flags open deals with nothing recorded for a week, and nothing else', () => {
    expect(findStalled([d()], now)).toEqual(['1 Main']);
    expect(findStalled([d({ lastEventAt: '2026-11-07T00:00:00Z' })], now)).toEqual([]); // something happened
    expect(findStalled([d({ updatedAt: '2026-11-08T00:00:00Z' })], now)).toEqual([]); // edited recently
    expect(findStalled([d({ status: 'Closed' })], now)).toEqual([]);
    expect(findStalled([d({ createdAt: '2026-11-05T00:00:00Z' })], now)).toEqual([]); // too new to call quiet
  });
  it('sends once a week: the key is the Monday of that week', () => {
    expect(weekKey('2026-11-09')).toBe('2026-11-09');
    expect(weekKey('2026-11-15')).toBe('2026-11-09');
    expect(weekKey('2026-11-16')).toBe('2026-11-16');
  });
});
