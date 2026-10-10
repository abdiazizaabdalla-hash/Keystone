import { supabaseServer } from './supabase';
import { getVisibleTcUserIds } from './team';

// Critical dates: the contract's own deadlines, kept separate from the
// checklist's task due dates (which are derived from acceptance/closing).
// See add-key-dates.sql.

export const KEY_DATE_KINDS = [
  'earnest_money',
  'inspection',
  'appraisal',
  'financing',
  'title_commitment',
  'closing',
  'custom',
] as const;
export type KeyDateKind = (typeof KEY_DATE_KINDS)[number];

export const KEY_DATE_LABELS: Record<KeyDateKind, string> = {
  earnest_money: 'Earnest money due',
  inspection: 'Inspection deadline',
  appraisal: 'Appraisal deadline',
  financing: 'Financing contingency',
  title_commitment: 'Title commitment due',
  closing: 'Closing',
  custom: 'Custom date',
};

export interface KeyDateRow {
  id: string;
  transaction_id: string;
  kind: KeyDateKind;
  label: string;
  due_date: string; // YYYY-MM-DD
  completed: boolean;
  source: 'contract' | 'manual';
  notify_agent: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

export function isKeyDateKind(value: unknown): value is KeyDateKind {
  return typeof value === 'string' && (KEY_DATE_KINDS as readonly string[]).includes(value);
}

export function cleanLabel(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim().slice(0, 100) : '';
  return s || fallback;
}

/**
 * Can this user see/edit this transaction's critical dates? A platform admin
 * can; otherwise the transaction must belong to the caller or someone whose
 * deals they can see (their team).
 */
export async function canAccessTransactionDates(
  transactionId: string,
  userId: string,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;
  const { data: tx } = await supabaseServer
    .from('transactions')
    .select('agent_id, tc_user_id')
    .eq('id', transactionId)
    .single();
  if (!tx) return false;

  const visibleIds = await getVisibleTcUserIds(userId);
  if (tx.tc_user_id && visibleIds.includes(tx.tc_user_id as string)) return true;

  const { data: agent } = await supabaseServer
    .from('agents')
    .select('id')
    .eq('id', tx.agent_id)
    .in('tc_user_id', visibleIds)
    .single();
  return Boolean(agent);
}

/** Whole days from today (UTC date) until an ISO date; negative = overdue. */
export function daysUntil(iso: string, todayIso = new Date().toISOString().split('T')[0]): number {
  const ms = new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${todayIso}T00:00:00Z`).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}
