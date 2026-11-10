import { describe, expect, it } from 'vitest';
import { alertOf, type AlertRow } from '@/lib/automation/alertCore';

const row = (over: Partial<AlertRow>): AlertRow => ({ id: 'a1', kind: 'notify_user', status: 'executed', inputs: { title: 'Inspection is in 3 days', body: 'Confirm access.' }, result: { delivered: true }, refusal_reason: null, created_at: '2026-11-09T10:00:00Z', executed_at: '2026-11-09T10:00:05Z', instance_id: 'i1', ...over });

describe('alertOf (the banners)', () => {
  it('a reminder that ran is a reminder banner with its text', () => {
    expect(alertOf(row({}), 'Inspection reminders')).toMatchObject({ kind: 'reminder', title: 'Inspection is in 3 days', body: 'Confirm access.', automation: 'Inspection reminders' });
  });
  it('an acknowledged reminder is gone', () => {
    expect(alertOf(row({ result: { delivered: true, acknowledgedAt: '2026-11-09T12:00:00Z' } }), 'x')).toBeNull();
  });
  it('a muted reminder (the person turned assistant notifications off) makes no banner', () => {
    expect(alertOf(row({ result: { muted: true } }), 'x')).toBeNull();
  });
  it('a draft email waiting is an approval banner, and acknowledging does not hide it', () => {
    const r = row({ kind: 'send_deal_email', status: 'awaiting_approval', inputs: { to: ['a@b.com'], subject: 'Welcome', message: 'hi' }, result: { acknowledgedAt: 'x' } });
    expect(alertOf(r, 'x')).toMatchObject({ kind: 'approval', body: 'Welcome to a@b.com' });
  });
  it('an email that could not go is a problem banner with the reason in words', () => {
    const r = row({ kind: 'send_deal_email', status: 'refused', inputs: { to: [], subject: 'Hello', message: 'm' }, result: null, refusal_reason: 'no_recipients' });
    const a = alertOf(r, 'x')!;
    expect(a.kind).toBe('problem');
    expect(a.body).toMatch(/nobody to send it to/i);
  });
  it('whole-account reasons (assistant Off, paused, no plan) do not make one banner per step', () => {
    for (const reason of ['mode_off', 'kill_switch', 'feature_off', 'not_entitled']) expect(alertOf(row({ kind: 'send_deal_email', status: 'refused', result: null, refusal_reason: reason }), 'x')).toBeNull();
  });
  it('tasks and notes that simply happened never make a banner', () => {
    expect(alertOf(row({ kind: 'create_task', inputs: { name: 'T' } }), 'x')).toBeNull();
    expect(alertOf(row({ kind: 'add_note', inputs: { text: 'N' } }), 'x')).toBeNull();
  });
});
