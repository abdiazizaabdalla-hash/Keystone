import { describe, expect, it } from 'vitest';
import { categoryOfRole, dueSteps, fillVars, missingRecipientRoles, resolveRecipients, validateDefinition, type InstanceFacts, type Step } from '@/lib/automation/library';

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
    ['a condition on a listing automation', { ...base, category: 'listing', triggerType: 'listing_created', steps: [{ ...email, condition: { type: 'role_present', role: 'seller' } }] }],
    ['a deal trigger on a listing automation', { ...base, category: 'listing', triggerType: 'closing_date', steps: [email] }],
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

import { COMING_SOON, PRESETS } from '@/lib/automation/presets';

describe('preset library', () => {
  it('has unique ids and every preset passes the same validation as a hand-made automation', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      const r = validateDefinition({ name: p.name, description: p.summary, category: p.category, triggerType: p.triggerType, steps: p.steps });
      expect(r.ok, `${p.id}: ${r.ok ? '' : r.error}`).toBe(true);
    }
    expect(PRESETS.filter((p) => p.category === 'transaction').length).toBeGreaterThanOrEqual(10);
    expect(PRESETS.filter((p) => p.category === 'listing').length).toBeGreaterThanOrEqual(4);
    expect(COMING_SOON.length).toBeGreaterThan(0);
  });
  it('every email placeholder is one the engine fills in', () => {
    const known = new Set(['address', 'file_number', 'closing_date', 'client_name']);
    for (const p of PRESETS) for (const s of p.steps) for (const text of [s.subject, s.message, s.title, s.body, s.name, s.text]) for (const m of (text ?? '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) expect(known.has(m[1].toLowerCase()), `${p.id}: {{${m[1]}}}`).toBe(true);
  });
});

describe('critical-date triggers', () => {
  const step: Step = { id: 'k', type: 'notify_me', when: { days: 2, direction: 'before' }, title: 'x' };
  it('fire from the deal critical date and stop once it is marked done', () => {
    const open = facts({ keyDates: { earnest_money: { date: '2026-11-15', completed: false } } });
    expect(dueSteps('i1', 'earnest_money_due', [step], open, new Date('2026-11-13T17:00:00Z'), new Set())).toHaveLength(1);
    const done = facts({ keyDates: { earnest_money: { date: '2026-11-15', completed: true } } });
    expect(dueSteps('i1', 'earnest_money_due', [step], done, new Date('2026-11-13T17:00:00Z'), new Set())).toEqual([]);
    expect(dueSteps('i1', 'earnest_money_due', [step], facts(), new Date('2026-11-13T17:00:00Z'), new Set())).toEqual([]);
  });
});


describe('missingRecipientRoles', () => {
  const mail = (to: string[]): Step => ({ id: 'm', type: 'send_email', when: { days: 0, direction: 'after' }, to, subject: 's', message: 'm' });
  const people = [
    { name: 'Ann', email: 'ann@x.com', role: 'Agent', category: 'Agent' },
    { name: 'Bo', email: 'bo@x.com', role: 'Buyer', category: 'Buyer' },
  ];
  it('names the roles nobody on the deal can receive, and ignores non-email steps', () => {
    expect(missingRecipientRoles([mail(['buyer', 'lender', 'title'])], people)).toEqual(['Lender', 'Title / escrow']);
    expect(missingRecipientRoles([mail(['agent']), { id: 'n', type: 'notify_me', when: { days: 0, direction: 'after' }, title: 't' }], people)).toEqual([]);
    expect(missingRecipientRoles([mail(['everyone'])], [])).toEqual(['Everyone on the deal']);
  });
});

import { conditionMet, describeCondition } from '@/lib/automation/library';

describe('conditions', () => {
  const ctx = { keyDates: [{ kind: 'appraisal', completed: true }, { kind: 'financing', completed: false }], people: [{ name: 'Ann', email: 'ann@x.com', role: 'Agent', category: 'Agent' }], documents: ['purchase contract contract.pdf'] };
  it('checks a Critical date, a role and a document', () => {
    expect(conditionMet(null, ctx)).toBe(true);
    expect(conditionMet({ type: 'key_date_open', kind: 'appraisal' }, ctx)).toBe(false); // marked done
    expect(conditionMet({ type: 'key_date_open', kind: 'financing' }, ctx)).toBe(true);
    expect(conditionMet({ type: 'key_date_open', kind: 'inspection' }, ctx)).toBe(true); // no such date: nothing marked done
    expect(conditionMet({ type: 'role_missing', role: 'lender' }, ctx)).toBe(true);
    expect(conditionMet({ type: 'role_present', role: 'agent' }, ctx)).toBe(true);
    expect(conditionMet({ type: 'no_document', text: 'Appraisal' }, ctx)).toBe(true);
    expect(conditionMet({ type: 'no_document', text: 'purchase contract' }, ctx)).toBe(false);
  });
  it('validates conditions and describes them in words', () => {
    const base = { name: 'x', description: '', category: 'transaction', triggerType: 'appraisal_deadline', steps: [{ id: 's1', type: 'notify_me', when: { days: 2, direction: 'before' }, title: 't', condition: { type: 'key_date_open', kind: 'appraisal' } }] };
    const ok = validateDefinition(base);
    expect(ok.ok && ok.value.steps[0].condition).toEqual({ type: 'key_date_open', kind: 'appraisal' });
    expect(validateDefinition({ ...base, steps: [{ ...base.steps[0], condition: { type: 'run_sql', text: 'x' } }] }).ok).toBe(false);
    expect(validateDefinition({ ...base, steps: [{ ...base.steps[0], condition: { type: 'role_missing', role: 'everyone' } }] }).ok).toBe(false);
    expect(describeCondition({ type: 'role_missing', role: 'lender' })).toBe('the deal has no Lender');
  });
});

describe('listing emails, tasks and the offer trigger', () => {
  const email = { id: 's1', type: 'send_email', when: { days: 0, direction: 'after' }, to: ['seller'], subject: 'New offer on {{address}}', message: 'Hello' };
  const task = { id: 's2', type: 'create_task', when: { days: 0, direction: 'after' }, name: 'Review offer', dueInDays: 1 };
  const def = { name: 'Offer', description: '', category: 'listing', triggerType: 'offer_received', steps: [email, task] };

  it('accepts email and checklist steps on a listing', () => {
    expect(validateDefinition(def).ok).toBe(true);
  });
  it('refuses "before" on the offer trigger (it is an event, not a date)', () => {
    expect(validateDefinition({ ...def, steps: [{ ...email, when: { days: 1, direction: 'before' } }] }).ok).toBe(false);
  });
  it('fires after an offer arrives, once, and not for an offer from before the copy existed', () => {
    const f = { createdAt: '2026-11-01T10:00:00Z', timeZone: 'UTC', dealCreatedAt: null, closingDate: null, acceptanceDate: null, plannedListDate: null, expirationDate: null, events: { offer_received: '2026-11-03T09:00:00Z' } };
    const now = new Date('2026-11-03T09:30:00Z');
    const due = dueSteps('i1', 'offer_received', def.steps as never, f, now, new Set());
    expect(due.map((d) => d.step.id)).toEqual(['s1', 's2']);
    expect(dueSteps('i1', 'offer_received', def.steps as never, f, now, new Set(due.map((d) => d.key)))).toEqual([]);
    expect(dueSteps('i1', 'offer_received', def.steps as never, { ...f, events: {} }, now, new Set())).toEqual([]);
  });
  it('a second offer fires the steps again (its own anchor)', () => {
    const f = { createdAt: '2026-11-01T10:00:00Z', timeZone: 'UTC', dealCreatedAt: null, closingDate: null, acceptanceDate: null, plannedListDate: null, expirationDate: null, events: { offer_received: '2026-11-03T09:00:00Z' } };
    const first = dueSteps('i1', 'offer_received', def.steps as never, f, new Date('2026-11-03T09:30:00Z'), new Set());
    const second = dueSteps('i1', 'offer_received', def.steps as never, { ...f, events: { offer_received: '2026-11-04T12:00:00Z' } }, new Date('2026-11-04T12:30:00Z'), new Set(first.map((d) => d.key)));
    expect(second.length).toBe(2);
  });
});

describe('listing contact roles', () => {
  it.each([
    ['Seller', 'Seller'], ["Seller's attorney", 'Attorney'], ['Lender', 'Lender'], ['Title / escrow officer', 'Title'], ['Home inspector', 'Inspector'], ['Photographer', 'Other'], [null, 'Other'],
  ])('%s -> %s', (role, cat) => {
    expect(categoryOfRole(role as string | null)).toBe(cat);
  });
  it('emails go only to listing people with an address, by role', () => {
    const people = [{ name: 'Sam', email: 'sam@x.com', role: 'Seller', category: 'Seller' }, { name: 'Lee', email: null, role: 'Lender', category: 'Lender' }];
    expect(resolveRecipients(['seller'], people)).toEqual(['sam@x.com']);
    expect(missingRecipientRoles([{ id: 's1', type: 'send_email', when: { days: 0, direction: 'after' }, to: ['lender'] }], people)).toEqual(['Lender']);
  });
});
