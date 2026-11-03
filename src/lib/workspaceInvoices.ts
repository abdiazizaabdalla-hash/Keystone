import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { getEntitlements } from '@/lib/entitlements';
import type { WithAppMetadata } from '@/lib/privileged';
import { hasAgentRole } from '@/lib/privileged';
import { isFeatureOn } from '@/lib/features';
import { isTeamPlan } from '@/lib/plans';
import { getUserPlan } from '@/lib/appMetadata';

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export { invoiceTotals } from '@/lib/workspaceInvoiceMath';

/** Only an agent with a workspace has these invoices. */
export function assertWorkspaceAgent(user: WithAppMetadata): void {
  if (getEntitlements(user).kind !== 'agent_workspace') {
    throw new AuthError('Invoices are available on an agent workspace account', 403);
  }
}

/**
 * Who may write free-form invoices: an agent with a workspace, or a brokerage owner (Team/Brokerage plan, brokerage
 * feature on) who bills agents, vendors or anyone else from the Invoices page.
 */
export function assertInvoiceSender(user: WithAppMetadata): void {
  if (getEntitlements(user).kind === 'agent_workspace') return;
  if (isFeatureOn('brokerage') && isTeamPlan(getUserPlan(user))) return;
  throw new AuthError('Invoices are available on an agent workspace or a brokerage account', 403);
}

/** The next free number for this owner, such as INV-0007. */
export async function nextInvoiceNumber(ownerId: string): Promise<string> {
  const { data } = await supabaseServer.from('workspace_invoices').select('invoice_number').eq('owner_user_id', ownerId);
  let highest = 0;
  for (const row of data || []) {
    const m = /^INV-(\d+)$/.exec(String(row.invoice_number));
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `INV-${String(highest + 1).padStart(4, '0')}`;
}

export interface DealCoordinator {
  userId: string;
  name: string;
  email: string | null;
}

/**
 * The coordinator on a deal, if there is one. A deal has a coordinator when it is owned by a coordinator, or when a
 * coordinator (a participant who is not an agent login) has been added to it. An agent's deal with nobody else on it
 * has none, and so can have no invoice attached.
 */
export async function findDealCoordinator(transactionId: string, askingUserId: string): Promise<DealCoordinator | null> {
  const { data: tx } = await supabaseServer.from('transactions').select('tc_user_id').eq('id', transactionId).maybeSingle();
  if (!tx) return null;
  const candidates: string[] = [];
  if (tx.tc_user_id) candidates.push(tx.tc_user_id as string);
  const { data: links } = await supabaseServer.from('transaction_agents').select('agent_user_id').eq('transaction_id', transactionId);
  for (const l of links || []) candidates.push(l.agent_user_id as string);
  for (const id of candidates) {
    if (id === askingUserId) continue;
    const { data } = await supabaseServer.auth.admin.getUserById(id);
    const u = data.user;
    if (!u || hasAgentRole(u)) continue;
    const meta = u.user_metadata || {};
    const name = typeof meta.full_name === 'string' && meta.full_name.trim() ? meta.full_name.trim() : u.email || 'Coordinator';
    return { userId: u.id, name, email: u.email ?? null };
  }
  return null;
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const money = (v: unknown, max = 99_999_999) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n * 100) / 100, max) : 0;
};

export const MAX_INVOICE_LINES = 30;

export function cleanLines(raw: unknown): InvoiceLineInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_INVOICE_LINES).map((l) => {
    const r = (l ?? {}) as Record<string, unknown>;
    return { description: clip(r.description, 300), quantity: money(r.quantity ?? 1, 99_999), unitPrice: money(r.unitPrice) };
  });
}

export function cleanDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
}

export function cleanHeader(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (body.title !== undefined) out.title = clip(body.title, 140);
  if (body.billToName !== undefined) out.bill_to_name = clip(body.billToName, 140);
  if (body.billToEmail !== undefined) {
    const e = clip(body.billToEmail, 254).toLowerCase();
    out.bill_to_email = e && e.includes('@') ? e : null;
  }
  if (body.billToAddress !== undefined) out.bill_to_address = clip(body.billToAddress, 400) || null;
  if (body.memo !== undefined) out.memo = clip(body.memo, 2000) || null;
  if (body.taxPercent !== undefined) out.tax_percent = Math.min(money(body.taxPercent, 100), 100);
  if (body.issueDate !== undefined) {
    const d = cleanDate(body.issueDate);
    if (d) out.issue_date = d;
  }
  if (body.dueDate !== undefined) out.due_date = cleanDate(body.dueDate);
  return out;
}

/** An invoice and its lines, only if it belongs to `ownerId`. */
export async function loadOwnInvoice(invoiceId: string, ownerId: string) {
  const { data: invoice } = await supabaseServer.from('workspace_invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (!invoice || invoice.owner_user_id !== ownerId) throw new AuthError('Invoice not found', 404);
  const { data: lines } = await supabaseServer
    .from('workspace_invoice_lines')
    .select('id, position, description, quantity, unit_price')
    .eq('invoice_id', invoiceId)
    .order('position');
  return { invoice, lines: (lines || []).map((l) => ({ id: l.id as string, description: l.description as string, quantity: Number(l.quantity), unitPrice: Number(l.unit_price) })) };
}

export async function replaceLines(invoiceId: string, lines: InvoiceLineInput[]) {
  const { error: delError } = await supabaseServer.from('workspace_invoice_lines').delete().eq('invoice_id', invoiceId);
  if (delError) throw delError;
  if (lines.length === 0) return;
  const { error } = await supabaseServer
    .from('workspace_invoice_lines')
    .insert(lines.map((l, i) => ({ invoice_id: invoiceId, position: i, description: l.description, quantity: l.quantity, unit_price: l.unitPrice })));
  if (error) throw error;
}
