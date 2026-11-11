import { describe, it, expect } from 'vitest';
import { conditionMet, dueSteps, triggerAnchor, validateDefinition, type InstanceFacts, type Step } from '@/lib/automation/library';
import { stepToRequest } from '@/lib/automation/stepRequest';

const base = { name: 'Inspection chain', category: 'transaction', triggerType: 'task_completed', triggerTask: 'inspection scheduling', steps: [{ id: 's1', type: 'create_task', name: 'Collect inspection report', dueInDays: 3, dueFrom: 'trigger', businessDays: true, when: { days: 0, direction: 'after' } }] };

describe('task-driven automations: definition', () => {
  it('accepts a step-watching trigger with a step name and the new actions', () => {
    const ok = validateDefinition({ ...base, steps: [...base.steps, { id: 's2', type: 'set_task_due', taskName: 'inspection report', dueInDays: 5, when: { days: 0, direction: 'after' } }, { id: 's3', type: 'reopen_task', taskName: 'appraisal', when: { days: 1, direction: 'after' } }] });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.triggerTask).toBe('inspection scheduling');
      expect(ok.value.steps[0].businessDays).toBe(true);
      expect(ok.value.steps[0].dueFrom).toBe('trigger');
    }
  });
  it('requires a step name for a step trigger', () => {
    expect(validateDefinition({ ...base, triggerTask: '' }).ok).toBe(false);
  });
  it('rejects the new actions on a listing and an empty step name', () => {
    expect(validateDefinition({ ...base, category: 'listing', triggerType: 'listing_created', steps: [{ id: 's1', type: 'reopen_task', taskName: 'x1', when: { days: 0, direction: 'after' } }] }).ok).toBe(false);
    expect(validateDefinition({ ...base, steps: [{ id: 's1', type: 'reopen_task', taskName: '', when: { days: 0, direction: 'after' } }] }).ok).toBe(false);
  });
  it('accepts a "step is completed" condition', () => {
    expect(validateDefinition({ ...base, steps: [{ ...base.steps[0], condition: { type: 'task_done', text: 'closing prep' } }] }).ok).toBe(true);
  });
});

describe('task-driven automations: running', () => {
  const facts = (over: Partial<InstanceFacts>): InstanceFacts => ({ createdAt: '2026-11-01T00:00:00Z', timeZone: 'America/Chicago', dealCreatedAt: null, closingDate: null, acceptanceDate: null, plannedListDate: null, expirationDate: null, events: {}, ...over });
  const steps = base.steps as unknown as Step[];

  it('waits until the watched step is completed, then fires once per completion', () => {
    expect(dueSteps('i1', 'task_completed', steps, facts({}), new Date('2026-11-10T12:00:00Z'), new Set())).toHaveLength(0);
    const done = facts({ events: { task_completed: '2026-11-10T11:00:00Z' } });
    const due = dueSteps('i1', 'task_completed', steps, done, new Date('2026-11-10T12:00:00Z'), new Set());
    expect(due).toHaveLength(1);
    expect(dueSteps('i1', 'task_completed', steps, done, new Date('2026-11-10T12:30:00Z'), new Set([due[0].key]))).toHaveLength(0);
    const again = facts({ events: { task_completed: '2026-11-11T09:00:00Z' } });
    expect(dueSteps('i1', 'task_completed', steps, again, new Date('2026-11-11T10:00:00Z'), new Set([due[0].key]))).toHaveLength(1);
  });
  it('a step due-date trigger anchors on the open step and stops when there is none', () => {
    expect(triggerAnchor('task_due', facts({ taskDue: '2026-11-20' }))).toEqual({ kind: 'day', day: '2026-11-20' });
    expect(triggerAnchor('task_due', facts({ taskDue: null }))).toBeNull();
  });
  it('overdue escalation: "1 day after" the due date fires the day after', () => {
    const esc = [{ id: 's1', type: 'notify_me', title: 'Overdue', when: { days: 1, direction: 'after' } }] as Step[];
    expect(dueSteps('i2', 'task_due', esc, facts({ taskDue: '2026-11-09' }), new Date('2026-11-10T18:00:00Z'), new Set())).toHaveLength(1);
    expect(dueSteps('i2', 'task_due', esc, facts({ taskDue: '2026-11-10' }), new Date('2026-11-10T18:00:00Z'), new Set())).toHaveLength(0);
  });
  it('conditions read the checklist', () => {
    const ctx = { keyDates: [], people: [], documents: [], tasks: [{ name: 'closing prep: keys', completed: true }, { name: 'closing prep: utilities', completed: false }] };
    expect(conditionMet({ type: 'task_done', text: 'closing prep' }, ctx)).toBe(false);
    expect(conditionMet({ type: 'task_open', text: 'utilities' }, ctx)).toBe(true);
    expect(conditionMet({ type: 'task_done', text: 'keys' }, ctx)).toBe(true);
    expect(conditionMet({ type: 'task_done', text: 'nonexistent' }, ctx)).toBe(false);
  });
  it('the next task gets a business-day due date from the trigger, or days before closing', () => {
    const vars = { anchor_iso: '2026-11-13', closing_iso: '2026-12-15' };
    const next = stepToRequest(steps[0], { ...vars }, [], 'America/Chicago', new Date('2026-11-13T15:00:00Z'));
    expect(next.kind).toBe('create_task');
    expect(next.inputs.dueDate).toBe('2026-11-18');
    const walk = stepToRequest({ id: 's', type: 'create_task', name: 'Walkthrough', dueInDays: 2, dueFrom: 'closing', dueBefore: true, when: { days: 0, direction: 'after' } }, vars, [], 'America/Chicago', new Date('2026-11-13T15:00:00Z'));
    expect(walk.inputs.dueDate).toBe('2026-12-13');
  });
});
