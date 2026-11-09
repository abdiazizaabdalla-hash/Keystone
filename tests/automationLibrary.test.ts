import { describe, expect, it } from 'vitest';
import { dueSteps, fillVars, resolveRecipients, validateDefinition, type InstanceFacts, type Step } from '@/lib/automation/library';

const email: Step = { id: 's1', type: 'send_email', when: { days: 0, direction: 'after' }, to: ['buyer'], subject: 'Welcome', message: 'Hi' };
const base = { name: 'Onboarding', description: '', category: 'transaction', triggerType: 'transaction_created', steps: [email] };
const facts = (over: Partial<InstanceFacts> = {}): InstanceFacts => ({
  createdAt: '2026-11-09T15:00:00Z', timeZone: 'America/Chicago', dealCreatedAt: '2026-11-09T14:59:30Z',
  closingDate: null, acceptanceDate: null, plannedListDate: null, expirationDate: null, events: {}, ...over,
});

describe('validateDefinition', () => {
  it('accepts a good automation and fills step ids', () => {
    const r = validateDefinition({ ...base, steps: [{ ...email, id: undefined }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.steps[0].id).toBe('s1');
  });
  it.each([
    ['no name', { ...base, name: ' ' }],
    ['bad category', { ...base, category: 'team' }],
    ['trigger from the other category', { ...base, triggerType: 'listing_created' }],
    ['no steps', { ...base, steps: [] }],
    ['email with nobody to send to', { ...base, steps: [{ ...email, to: [] }] }],
    ['email to an arbitrary role', { ...base, steps: [{ ...email, to: ['someone@example.com'] }] }],
    ['unknown action', { ...base, steps: [{ ...email, type: 'delete_deal' }] }],
    ['email on a listing automation', { ...base, category: 'listing', triggerType: 'listing_created', steps: [email] }],
    ['"before" on an event trigger', { ...base, steps: [{ ...email, when: { days: 2, direction: 'before' } }] }],
    ['negative days', { ...base, steps: [{ ...email, when: { days: -1, direction: 'after' } }] }],
    ['13 steps', { ...base, steps: Array.from({ length: 13 }, (_, i) => ({ ...email, id: `a${i}` })) }],
  ])('refuses %s', (_label, input) => {
    expect(validateDefinition(input).ok).toBe(false);
  });
});

describe('dueSteps', () => {
  const steps: Step[] = [email, { ...email, id: 's2', when: { days: 3, direction: 'after' } }];
  it('fires "right away" at creation but not the 3-day step yet', () => {
    const due = dueSteps('i1', 'transaction_created', steps, facts(), new Date('2026-11-09T15:05:00Z'), new Set());
    expect(due.map((d) => d.step.id)).toEqual(['s1']);
  });
  it('fires the delayed step 3 days later and never repeats a step it already fired', () => {
    const now = new Date('2026-11-12T15:05:00Z');
    const first = dueSteps('i1', 'transaction_created', steps, facts(), now, new Set());
    // (the "right away" step was never fired, and is now too stale to send, so only the 3-day step goes)
    expect(first.map((d) => d.step.id)).toEqual(['s2']);
    expect(dueSteps('i1', 'transaction_created', steps, facts(), now, new Set(first.map((d) => d.key)))).toEqual([]);
  });
  it('does not fire a step that was due long before the copy was applied (applied to an old deal)', () => {
    const f = facts({ dealCreatedAt: '2026-08-01T10:00:00Z' });
    expect(dueSteps('i1', 'transaction_created', steps, f, new Date('2026-11-09T16:00:00Z'), new Set())).toEqual([]);
  });
  it('skips what is more than 3 days overdue instead of firing it in a burst after an outage', () => {
    expect(dueSteps('i1', 'transaction_created', [email], facts(), new Date('2026-11-20T15:00:00Z'), new Set())).toEqual([]);
  });
  it('counts "2 days before closing" in the deal time zone and only once', () => {
    const closing: Step = { ...email, id: 'c', when: { days: 2, direction: 'before' } };
    const f = facts({ closingDate: '2026-11-15' });
    expect(dueSteps('i1', 'closing_date', [closing], f, new Date('2026-11-12T12:00:00Z'), new Set())).toEqual([]);
    const due = dueSteps('i1', 'closing_date', [closing], f, new Date('2026-11-13T17:00:00Z'), new Set());
    expect(due).toHaveLength(1);
    expect(due[0].key).toBe('inst:i1:c:2026-11-15');
  });
  it('skips a "before closing" step whose day had already passed when the copy was applied', () => {
    const closing: Step = { ...email, id: 'c', when: { days: 5, direction: 'before' } };
    const f = facts({ closingDate: '2026-11-11' }); // due day 2026-11-06, copy applied 2026-11-09
    expect(dueSteps('i1', 'closing_date', [closing], f, new Date('2026-11-09T16:00:00Z'), new Set())).toEqual([]);
  });
  it('a moved closing date schedules the steps again under a new key', () => {
    const closing: Step = { ...email, id: 'c', when: { days: 1, direction: 'before' } };
    const a = dueSteps('i1', 'closing_date', [closing], facts({ closingDate: '2026-11-10' }), new Date('2026-11-09T18:00:00Z'), new Set());
    const b = dueSteps('i1', 'closing_date', [closing], facts({ closingDate: '2026-11-10' }), new Date('2026-11-09T18:00:00Z'), new Set(a.map((x) => x.key)));
    const c = dueSteps('i1', 'closing_date', [closing], facts({ closingDate: '2026-11-11' }), new Date('2026-11-10T18:00:00Z'), new Set(a.map((x) => x.key)));
    expect(a).toHaveLength(1);
    expect(b).toEqual([]);
    expect(c).toHaveLength(1);
  });
  it('an event trigger waits until the event has happened after the copy was applied', () => {
    const s: Step = { ...email, id: 'e', when: { days: 1, direction: 'after' } };
    expect(dueSteps('i1', 'contract_uploaded', [s], facts(), new Date('2026-11-12T00:00:00Z'), new Set())).toEqual([]);
    const f = facts({ events: { contract_uploaded: '2026-11-10T09:00:00Z' } });
    expect(dueSteps('i1', 'contract_uploaded', [s], f, new Date('2026-11-10T08:00:00Z'), new Set())).toEqual([]);
    expect(dueSteps('i1', 'contract_uploaded', [s], f, new Date('2026-11-11T10:00:00Z'), new Set())).toHaveLength(1);
  });
});

describe('recipients and variables', () => {
  const people = [
    { name: 'Ann', email: 'ann@x.com', role: 'Agent', category: 'Agent' },
    { name: 'Bo', email: 'Bo@x.com', role: 'Buyer', category: 'Buyer' },
    { name: 'Lee', email: null, role: 'Lender', category: 'Lender' },
    { name: 'Bo again', email: 'bo@x.com', role: 'Buyer', category: 'Buyer' },
  ];
  it('picks only people on the deal who match, once each, and never anyone without an email', () => {
    expect(resolveRecipients(['buyer'], people)).toEqual(['bo@x.com']);
    expect(resolveRecipients(['lender'], people)).toEqual([]);
    expect(resolveRecipients(['everyone'], people).sort()).toEqual(['ann@x.com', 'bo@x.com']);
    expect(resolveRecipients(['seller'], people)).toEqual([]);
  });
  it('fills known placeholders and leaves unknown ones visible', () => {
    expect(fillVars('Hi {{client_name}} at {{ address }} {{nope}}', { client_name: 'Bo', address: '1 Main' })).toBe('Hi Bo at 1 Main {{nope}}');
  });
});
