import { supabaseServer } from './supabase';
import { AuthError } from './auth';
import { getMutedTypes } from './notifications';
import { computeSplit, expectedGrossCents, fromCents, cleanBaseFees, isRateType, isSplitType, toCents, type BaseFee, type CommissionRate, type Deduction, type SplitType } from './commissionMath';
import { capProgress, isCapReset, type CapProgress, type CapReset, type CapTerms } from './commissionCap';
import { activeLinkForAgent, agentLabels, overseesAgent, type BrokerageLink } from './oversight';
import { CLOSED_STAGE } from './oversightMath';

// Commission agreements and statements between a brokerage owner and one of their agents, deal by deal.
// Only the owner and that agent can see or touch a commission; coordinators and the rest of the team never do.

// 'estimate': built from the agent's base terms, no confirmed gross yet (nothing to agree to and nothing to pay).
export type CommissionStatus = 'estimate' | 'proposed' | 'change_requested' | 'accepted' | 'paid' | 'void';

export interface CommissionRow {
  id: string;
  transaction_id: string;
  owner_user_id: string;
  agent_user_id: string;
  statement_number: string;
  gross_cents: number | null;
  split_type: SplitType;
  split_value: number | string;
  deductions: Deduction[];
  agent_net_cents: number | null;
  brokerage_net_cents: number | null;
  status: CommissionStatus;
  change_note: string | null;
  payment_preference: 'relay' | 'outside' | null;
  proposed_at: string;
  accepted_at: string | null;
  paid_on: string | null;
  paid_note: string | null;
  updated_at: string;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  commission_type?: 'percent' | 'flat' | null;
  commission_value?: number | string | null;
  estimated_gross_cents?: number | null;
  cap_snapshot?: { capCents: number; reset: CapReset; anchor: string | null } | null;
}

/** The numbers on a commission, recomputed from what was agreed (never trusted from the client). */
export interface Breakdown {
  gross: number | null;
  agentShare: number | null;
  brokerageShare: number | null;
  deductionsTotal: number | null;
  agentNet: number | null;
  brokerageNet: number | null;
  agentPercentOfGross: number | null;
}

export function breakdown(row: Pick<CommissionRow, 'gross_cents' | 'split_type' | 'split_value' | 'deductions'>): Breakdown {
  // An estimate with no figure yet has nothing to compute.
  if (row.gross_cents === null || row.gross_cents === undefined) return { gross: null, agentShare: null, brokerageShare: null, deductionsTotal: null, agentNet: null, brokerageNet: null, agentPercentOfGross: null };
  const s = computeSplit({ gross: fromCents(Number(row.gross_cents)), splitType: row.split_type, splitValue: Number(row.split_value), deductions: row.deductions ?? [] });
  return {
    gross: fromCents(s.grossCents),
    agentShare: fromCents(s.agentShareCents),
    brokerageShare: fromCents(s.brokerageShareCents),
    deductionsTotal: fromCents(s.deductionsCents),
    agentNet: fromCents(s.agentNetCents),
    brokerageNet: fromCents(s.brokerageNetCents),
    agentPercentOfGross: s.agentPercentOfGross,
  };
}

function rateOf(row: CommissionRow): CommissionRate | null {
  return isRateType(row.commission_type) && row.commission_value !== null && row.commission_value !== undefined ? { type: row.commission_type, value: Number(row.commission_value) } : null;
}

/** What an unconfirmed statement would come to at the expected gross (sale price x rate). Null when there is nothing to expect yet. */
function estimateOf(row: CommissionRow) {
  if (row.status !== 'estimate' || !row.estimated_gross_cents) return null;
  try {
    return breakdown({ gross_cents: row.estimated_gross_cents, split_type: row.split_type, split_value: row.split_value, deductions: row.deductions });
  } catch {
    return null;
  }
}

export function viewOf(row: CommissionRow) {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    statementNumber: row.statement_number,
    splitType: row.split_type,
    splitValue: Number(row.split_value),
    deductions: row.deductions ?? [],
    status: row.status,
    // 'estimate' until the brokerage owner confirms the actual gross commission from the closing documents; 'confirmed' after.
    grossStatus: row.status === 'estimate' ? ('estimate' as const) : ('confirmed' as const),
    confirmedAt: row.confirmed_at ?? null,
    // The commission rate this statement expects (percent of the sale price, or flat) and, while it is only an estimate, what that works out to.
    rate: rateOf(row),
    estimate: estimateOf(row),
    changeNote: row.change_note,
    // The agent generated this invoice themselves and it is waiting for the brokerage to approve or edit it.
    // (Stored as a change request with no note; a real change request always carries one.)
    submitted: row.status === 'change_requested' && !row.change_note,
    paymentPreference: row.payment_preference,
    proposedAt: row.proposed_at,
    acceptedAt: row.accepted_at,
    paidOn: row.paid_on,
    paidNote: row.paid_note,
    ...breakdown(row),
  };
}

export async function nextStatementNumber(ownerId: string): Promise<string> {
  const { data } = await supabaseServer.from('deal_commissions').select('statement_number').eq('owner_user_id', ownerId);
  let highest = 0;
  for (const r of data ?? []) {
    const m = /^COMM-(\d+)$/.exec(String(r.statement_number));
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `COMM-${String(highest + 1).padStart(4, '0')}`;
}

export async function commissionForTransaction(transactionId: string): Promise<CommissionRow | null> {
  const { data, error } = await supabaseServer.from('deal_commissions').select('*').eq('transaction_id', transactionId).maybeSingle();
  if (error) throw error;
  return (data as CommissionRow | null) ?? null;
}

/** A commission the caller is a party to, or a 404 (a stranger learns nothing). */
export async function loadCommissionFor(id: string, userId: string): Promise<{ row: CommissionRow; side: 'owner' | 'agent' }> {
  const { data, error } = await supabaseServer.from('deal_commissions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  const row = data as CommissionRow | null;
  if (!row) throw new AuthError('Not found', 404);
  if (row.owner_user_id === userId) return { row, side: 'owner' };
  if (row.agent_user_id === userId) return { row, side: 'agent' };
  throw new AuthError('Not found', 404);
}

/** A line in someone's notification bell about a commission. Never throws. */
export async function notifyCommission(params: { recipientId: string; actorId: string; transactionId: string; title: string; link: string; email?: { source: string; subject: string; paragraphs: string[]; linkLabel: string } }): Promise<void> {
  try {
    if ((await getMutedTypes(params.recipientId)).includes('commission')) return;
    await supabaseServer.from('notifications').insert({ recipient_user_id: params.recipientId, actor_user_id: params.actorId, transaction_id: params.transactionId, event_type: 'commission', title: params.title.slice(0, 200), link: params.link });
    // The moments an agent is waiting on money also get an email (the bell is easy to miss).
    if (params.email) {
      const { sendBrokerageEmail } = await import('./oversightServer');
      await sendBrokerageEmail({ outboxOwnerId: params.actorId, fromLabel: 'Relay TC', to: { userId: params.recipientId }, source: params.email.source, subject: params.email.subject, paragraphs: params.email.paragraphs, path: params.link, linkLabel: params.email.linkLabel });
    }
  } catch (error) {
    console.error('Commission notification failed:', error);
  }
}

export const isMissingTable = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01';
};

// --- The brokerage's base terms for an agent, and the estimate statement built from them ---

export interface BaseTerms {
  commission: CommissionRate | null;
  split: { type: SplitType; value: number } | null;
  fees: BaseFee[];
  cap: CapTerms | null;
}

type LinkTerms = Partial<Pick<BrokerageLink, 'default_split_type' | 'default_split_value' | 'responded_at'>> & {
  default_commission_type?: string | null;
  default_commission_value?: number | string | null;
  default_fees?: unknown;
  cap_cents?: number | string | null;
  cap_reset?: string | null;
  cap_start?: string | null;
};

/** What a brokerage has set for an agent. Nothing is assumed: an unset split is null, no fees is an empty list, no cap is null. */
export function termsFromLink(link: LinkTerms | null | undefined): BaseTerms {
  if (!link) return { commission: null, split: null, fees: [], cap: null };
  const type = link.default_split_type;
  const value = link.default_split_value;
  const split = isSplitType(type) && value !== null && value !== undefined ? { type, value: Number(value) } : null;
  let fees: BaseFee[] = [];
  try {
    fees = cleanBaseFees(link.default_fees);
  } catch {
    fees = [];
  }
  const capCents = link.cap_cents === null || link.cap_cents === undefined ? 0 : Number(link.cap_cents);
  const cap = capCents > 0 && isCapReset(link.cap_reset) ? { capCents, reset: link.cap_reset, anchor: link.cap_start ?? (link.responded_at ? String(link.responded_at).slice(0, 10) : null) } : null;
  const commission = isRateType(link.default_commission_type) && link.default_commission_value !== null && link.default_commission_value !== undefined ? { type: link.default_commission_type, value: Number(link.default_commission_value) } : null;
  return { commission, split, fees, cap };
}

/**
 * Make the estimate statement for a deal if there is none (a closed deal, or an open one when the agent sends their invoice) and the agent's brokerage has set their terms. It carries the base
 * split, the default fees and the cap rule as they are right now, and no figures: the brokerage owner confirms those from the
 * closing documents. Returns the statement (new or existing) or null when there is nothing to base one on. Never throws.
 */
export async function ensureEstimateStatement(transactionId: string, options: { allowOpen?: boolean } = {}): Promise<CommissionRow | null> {
  try {
    const { data: tx } = await supabaseServer.from('transactions').select('id, tc_user_id, status, purchase_price').eq('id', transactionId).maybeSingle();
    if (!tx) return null;
    const existing = await commissionForTransaction(transactionId);
    if (existing) {
      // An estimate made before the brokerage set the agent's commission rate picks the rate up once it is set (until the owner confirms).
      if (existing.status === 'estimate' && (tx.status === CLOSED_STAGE || options.allowOpen) && !existing.commission_type) {
        const link = await activeLinkForAgent(existing.agent_user_id);
        const rate = link && link.owner_user_id === existing.owner_user_id ? termsFromLink(link).commission : null;
        if (rate) {
          const price = tx.purchase_price === null || tx.purchase_price === undefined ? null : Number(tx.purchase_price);
          const { data } = await supabaseServer.from('deal_commissions').update({ commission_type: rate.type, commission_value: rate.value, estimated_gross_cents: expectedGrossCents(price, rate) }).eq('id', existing.id).select('*').single();
          if (data) return data as CommissionRow;
        }
      }
      return existing;
    }
    // A statement is made when a deal closes, or earlier when the agent sends their commission invoice (allowOpen).
    if (tx.status !== CLOSED_STAGE && !options.allowOpen) return null;
    const agentId = tx.tc_user_id as string | undefined;
    if (!agentId) return null;
    const link = await activeLinkForAgent(agentId);
    if (!link || !(await overseesAgent(link.owner_user_id, agentId))) return null;
    const terms = termsFromLink(link);
    if (!terms.split) return null;
    const price = tx.purchase_price === null || tx.purchase_price === undefined ? null : Number(tx.purchase_price);
    const expected = expectedGrossCents(price, terms.commission);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabaseServer
        .from('deal_commissions')
        .insert({
          transaction_id: transactionId,
          owner_user_id: link.owner_user_id,
          agent_user_id: agentId,
          statement_number: await nextStatementNumber(link.owner_user_id),
          gross_cents: null,
          split_type: terms.split.type,
          split_value: terms.split.value,
          deductions: terms.fees.map((f) => ({ label: f.label, amount: f.amount })),
          agent_net_cents: null,
          brokerage_net_cents: null,
          status: 'estimate',
          cap_snapshot: terms.cap,
          commission_type: terms.commission?.type ?? null,
          commission_value: terms.commission?.value ?? null,
          estimated_gross_cents: expected,
        })
        .select('*')
        .single();
      if (!error) return data as CommissionRow;
      if (error.code !== '23505') throw error;
      const again = await commissionForTransaction(transactionId);
      if (again) return again;
    }
    return null;
  } catch (error) {
    if (!isMissingTable(error)) console.error('Could not create the commission estimate:', error);
    return null;
  }
}

/**
 * What a commission invoice for a deal would come to, from the brokerage's terms for the agent and the deal's sale price.
 * Everything is an estimate until the brokerage confirms the actual commission from the closing documents. Null figures mean the
 * terms are not enough to work them out (no commission rate, or no sale price yet).
 */
export function invoicePreview(price: number | null, terms: BaseTerms) {
  const rate = terms.commission;
  const grossCents = terms.split ? expectedGrossCents(price, rate) : null;
  const split = terms.split;
  const b = grossCents && split ? breakdown({ gross_cents: grossCents, split_type: split.type, split_value: split.value, deductions: terms.fees.map((f) => ({ label: f.label, amount: f.amount })) }) : null;
  return {
    salePrice: price,
    rate,
    split,
    fees: terms.fees.map((f) => ({ label: f.label, amount: f.amount })),
    gross: b?.gross ?? null,
    agentShare: b?.agentShare ?? null,
    brokerageShare: b?.brokerageShare ?? null,
    deductionsTotal: b?.deductionsTotal ?? null,
    agentNet: b?.agentNet ?? null,
    brokerageNet: b?.brokerageNet ?? null,
  };
}

export interface CapInfo extends CapProgress {
  capCents: number;
  reset: CapReset;
}

/** Where an agent stands against their cap, from the confirmed statements Relay holds for them. Null when they have no cap. */
export async function capInfoFor(ownerId: string, agentId: string, terms: BaseTerms, today: string): Promise<CapInfo | null> {
  if (!terms.cap) return null;
  const { data } = await supabaseServer
    .from('deal_commissions')
    .select('transaction_id, gross_cents, split_type, split_value, deductions, confirmed_at, status')
    .eq('owner_user_id', ownerId)
    .eq('agent_user_id', agentId)
    .not('status', 'in', '(estimate,void)')
    .limit(2000);
  const rows = (data ?? []) as Pick<CommissionRow, 'transaction_id' | 'gross_cents' | 'split_type' | 'split_value' | 'deductions' | 'confirmed_at' | 'status'>[];
  const closing = new Map<string, string | null>();
  for (let i = 0; i < rows.length; i += 80) {
    const { data: tx } = await supabaseServer.from('transactions').select('id, closing_date').in('id', rows.slice(i, i + 80).map((r) => r.transaction_id));
    for (const t of tx ?? []) closing.set(t.id as string, (t.closing_date as string | null) ?? null);
  }
  const contributions = rows
    .filter((r) => r.gross_cents !== null)
    .map((r) => ({ onDate: closing.get(r.transaction_id) ?? r.confirmed_at ?? today, cents: toCents(breakdown(r).brokerageShare ?? 0) }));
  return { capCents: terms.cap.capCents, reset: terms.cap.reset, ...capProgress(terms.cap, contributions, today) };
}

export const ownerLabelFor = async (ownerId: string) => (await agentLabels([ownerId])).get(ownerId) ?? null;
