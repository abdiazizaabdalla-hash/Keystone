import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertAgentOnTransaction } from '@/lib/agentPortal';
import type { TcInfo } from '@/lib/invoicePdf';

/**
 * `opts.allowAgent` + `opts.isAgent` lets the invited agent on this
 * invoice's own transaction through too -- gated via
 * assertAgentOnTransaction (transaction_agents), completely separate
 * from the `agent` row looked up below, which is the TC's own
 * commission/contact record (see lib/agentPortal.ts) and has no
 * relationship to the logged-in agent's auth.users id. Every existing
 * caller omits `opts`, so the TC-owner-or-admin check below is
 * unchanged for them.
 */
export async function loadInvoiceBundle(
  invoiceId: string,
  userId: string,
  isAdmin: boolean,
  opts: { allowAgent?: boolean; isAgent?: boolean } = {}
) {
  const { data: invoice, error } = await supabaseServer
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single();

  if (error || !invoice) {
    throw new AuthError('Invoice not found', 404);
  }

  const { data: agent } = await supabaseServer
    .from('agents')
    .select('id, name, brokerage, email, phone, commission_percent, flat_fee, tc_user_id')
    .eq('id', invoice.agent_id)
    .single();

  if (opts.allowAgent && opts.isAgent) {
    await assertAgentOnTransaction(invoice.transaction_id, userId);
  } else if (!isAdmin) {
    if (!agent || agent.tc_user_id !== userId) {
      throw new AuthError('You do not have permission to access this invoice', 403);
    }
  }

  const { data: transaction } = await supabaseServer
    .from('transactions')
    .select('id, file_number, property_address, purchase_price')
    .eq('id', invoice.transaction_id)
    .single();

  return { invoice, agent, transaction };
}

/**
 * The TC's own name/email, shown as the "Billed by" party on their
 * invoices -- previously invoices only carried the static "Relay TC"
 * product branding with no indication of which actual person the agent
 * was paying. Falls back to the "Relay TC" label only if the TC never
 * set a display name in Settings.
 */
export async function loadTcInfo(tcUserId: string): Promise<TcInfo> {
  const { data, error } = await supabaseServer.auth.admin.getUserById(tcUserId);
  if (error || !data.user) {
    return { name: 'Relay TC', email: null };
  }

  const meta = data.user.user_metadata || {};
  const name = typeof meta.full_name === 'string' && meta.full_name.trim() ? meta.full_name.trim() : 'Relay TC';
  const email = data.user.email || null;

  return { name, email };
}
