import { supabaseServer } from './supabase';
import { categoryForRole } from './contactCategories';
import { formatDisplayDate } from './dueDates';
import { stateFromAddress } from './usStates';
import type { MergeContext } from './templateMerge';

// Gathers what a template can fill in from a deal: the client, the agent, the address, the dates.

export interface DealPerson {
  name: string;
  email: string | null;
  /** Free-text role as saved on the deal ("Buyer", "Seller's agent"...), or 'Agent' for the deal's agent. */
  role: string;
  /** Broad group: Buyer, Seller, Agent, Lender... */
  category: string;
}

export interface DealForTemplates {
  id: string;
  address: string;
  state: string | null;
  fileNumber: string;
  price: number | null;
  status: string;
  closingDate: string | null;
  acceptanceDate: string | null;
  agent: DealPerson | null;
  contacts: DealPerson[];
}

export async function loadDealForTemplates(transactionId: string): Promise<DealForTemplates | null> {
  const { data: tx } = await supabaseServer.from('transactions').select('*').eq('id', transactionId).maybeSingle();
  if (!tx) return null;
  const { data: agentRow } = tx.agent_id ? await supabaseServer.from('agents').select('name, email').eq('id', tx.agent_id).maybeSingle() : { data: null };
  const { data: contactRows } = await supabaseServer.from('transaction_contacts').select('role, name, email').eq('transaction_id', transactionId).order('position', { ascending: true });
  const contacts: DealPerson[] = (contactRows || []).map((c) => ({
    name: ((c.name as string | null) || '').trim(),
    email: ((c.email as string | null) || '').trim() || null,
    role: ((c.role as string | null) || '').trim(),
    category: categoryForRole(c.role as string | null) ?? 'Other',
  }));
  return {
    id: tx.id as string,
    address: (tx.property_address as string) || '',
    state: (tx.property_state as string | null) ?? stateFromAddress(tx.property_address as string),
    fileNumber: (tx.file_number as string) || '',
    price: typeof tx.purchase_price === 'number' ? tx.purchase_price : tx.purchase_price ? Number(tx.purchase_price) : null,
    status: (tx.status as string) || '',
    closingDate: (tx.closing_date as string | null) ?? null,
    acceptanceDate: (tx.acceptance_date as string | null) ?? null,
    agent: agentRow ? { name: ((agentRow.name as string) || '').trim(), email: ((agentRow.email as string | null) || '').trim() || null, role: 'Agent', category: 'Agent' } : null,
    contacts,
  };
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? '';
const longDate = (d: string | null) => (d ? formatDisplayDate(d, { month: 'long', day: 'numeric', year: 'numeric' }) : '');
const money = (n: number | null) => (n == null || Number.isNaN(n) ? '' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));

/** People a message could go to: deal contacts with an email, plus the agent. */
export function recipientsOf(deal: DealForTemplates): DealPerson[] {
  return [...(deal.agent ? [deal.agent] : []), ...deal.contacts].filter((p) => p.email);
}

/**
 * Merge values for one message. `to` is who it is addressed to: for a buyer or seller the client fields are that
 * person; for anyone else they are the deal's first buyer or seller.
 */
export function buildMergeContext(deal: DealForTemplates, me: { name: string; email: string | null }, to?: DealPerson | null, today: Date = new Date()): MergeContext {
  const isClient = (p: DealPerson) => p.category === 'Buyer' || p.category === 'Seller';
  const client = to && isClient(to) ? to : deal.contacts.find(isClient) ?? null;
  return {
    client_name: client?.name ?? '',
    client_first_name: client ? firstName(client.name) : '',
    agent_name: deal.agent?.name ?? '',
    agent_first_name: deal.agent ? firstName(deal.agent.name) : '',
    my_name: me.name,
    my_email: me.email ?? '',
    tc_name: me.name,
    property_address: deal.address,
    property_state: deal.state ?? '',
    file_number: deal.fileNumber,
    purchase_price: money(deal.price),
    closing_date: longDate(deal.closingDate),
    acceptance_date: longDate(deal.acceptanceDate),
    today: today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  };
}

export function displayNameOf(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }): string {
  const full = typeof user.user_metadata?.full_name === 'string' ? (user.user_metadata.full_name as string).trim() : '';
  return full || user.email || 'Your transaction coordinator';
}
