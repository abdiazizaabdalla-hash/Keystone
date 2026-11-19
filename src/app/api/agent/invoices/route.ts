import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser, assertAgentOnOrOwnsTransaction, getAgentTransactionIds, getOwnedTransactionIds } from '@/lib/agentPortal';
import { isStripePayAvailable } from '@/lib/stripeConnect';

const INVOICE_FIELDS =
  'id, invoice_number, amount_owed, due_date, invoice_date, paid, paid_at, paid_amount, refunded, refunded_at, transaction_id, listing_id, kind, description';
const INVOICE_FIELDS_WITH_AGENT = `${INVOICE_FIELDS}, agent_id`;

// GET: the invoice(s) for this agent -- deliberately narrow fields (no
// commission_percent/flat_fee, nothing about other agents or
// transactions) since this is reachable by the agent, not just the TC.
//
// With ?transactionId=..., scoped to one deal -- the original shape this
// route had, still used by the agent's per-transaction page.
//
// Without it, every invoice across every transaction this agent has been
// added to, across every TC that's invited them -- the same "one login,
// union of what I've been added to" idea as GET /api/agent/transactions,
// just for invoices instead of deals. Each row carries enough of its
// transaction (file number/address, which TC) for a standalone list to
// be readable without a second round-trip per invoice.
//
// Every invoice also carries `payOnline`: whether its TC has an approved
// Stripe Connect account right now. The agent-facing pages use this to
// decide whether to offer "Pay Now" at all -- an agent clicking Pay and
// hitting "the TC hasn't finished Stripe onboarding" is a dead end only
// the TC can act on, so it's better not to offer the button in the first
// place. When it's false, those pages fall back to "invoice sent --
// download the PDF" instead.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!isAgentUser(user)) {
      return NextResponse.json({ error: 'This endpoint is for agent accounts only' }, { status: 403 });
    }

    const transactionId = request.nextUrl.searchParams.get('transactionId');

    if (transactionId) {
      await assertAgentOnOrOwnsTransaction(transactionId, user.id);

      const { data: invoices, error } = await supabaseServer
        .from('invoices')
        .select(INVOICE_FIELDS_WITH_AGENT)
        .eq('transaction_id', transactionId)
        .order('invoice_date', { ascending: false });
      if (error) throw error;

      // Online payment depends on the coordinator who made each invoice, not on whoever the deal's agent record belongs to.
      const owners = await invoiceOwners((invoices || []).map((i) => i.agent_id as string));
      const payByTc = new Map<string, boolean>();
      for (const tcId of new Set(owners.values())) payByTc.set(tcId, await isStripePayAvailable(tcId));
      const { data: tx } = await supabaseServer.from('transactions').select('id, file_number, property_address').eq('id', transactionId).maybeSingle();
      const labels = new Map<string, string>();
      for (const tcId of new Set(owners.values())) {
        const { data } = await supabaseServer.auth.admin.getUserById(tcId);
        labels.set(tcId, (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || 'Transaction coordinator');
      }
      return NextResponse.json(
        (invoices || []).map(({ agent_id, ...inv }) => {
          const tcId = owners.get(agent_id as string) || '';
          return {
            ...inv,
            payOnline: payByTc.get(tcId) || false,
            transaction: tx ? { id: tx.id, fileNumber: tx.file_number, propertyAddress: tx.property_address, tcLabel: labels.get(tcId) || 'Transaction coordinator' } : null,
          };
        })
      );
    }

    const listingIdParam = request.nextUrl.searchParams.get('listingId');

    // Deals the agent was added to, plus deals they own (a coordinator invoicing on one is billing them).
    const transactionIds = listingIdParam ? [] : [...new Set([...(await getAgentTransactionIds(user.id)), ...(await getOwnedTransactionIds(user.id))])];
    const dealInvoices: Record<string, unknown>[] = [];
    if (transactionIds.length > 0) {
      const { data: found, error } = await supabaseServer
        .from('invoices')
        .select(INVOICE_FIELDS_WITH_AGENT)
        .in('transaction_id', transactionIds)
        .order('invoice_date', { ascending: false });
      if (error) throw error;
      dealInvoices.push(...((found || []) as unknown as Record<string, unknown>[]));
    }

    // Listing fees: invoices a coordinator made for a listing. They belong to the agent the invoice is billed to (matched by
    // login email, the same rule that shares the listing itself) and to the owner of a listing a coordinator invoiced on.
    const listingInvoices: Record<string, unknown>[] = [];
    const email = (user.email || '').trim().toLowerCase();
    const { data: billedRows } = email
      ? await supabaseServer.from('agents').select('id').ilike('email', email.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(200)
      : { data: [] as { id: string }[] };
    const { data: ownedListings } = await supabaseServer.from('listings').select('id').eq('tc_user_id', user.id).limit(1000);
    const billedIds = (billedRows || []).map((a) => a.id as string);
    const ownedListingIds = (ownedListings || []).map((l) => l.id as string);
    const listingQueries = [];
    if (billedIds.length > 0) {
      const q0 = supabaseServer.from('invoices').select(INVOICE_FIELDS_WITH_AGENT).not('listing_id', 'is', null).in('agent_id', billedIds);
      listingQueries.push(listingIdParam ? q0.eq('listing_id', listingIdParam) : q0);
    }
    if (ownedListingIds.length > 0) {
      const q = supabaseServer.from('invoices').select(INVOICE_FIELDS_WITH_AGENT).in('listing_id', listingIdParam ? ownedListingIds.filter((x) => x === listingIdParam) : ownedListingIds);
      listingQueries.push(q);
    }
    for (const r of await Promise.all(listingQueries)) {
      // add-listing-invoices.sql not run yet: there are no listing invoices to show.
      if (r.error) { console.error('agent listing invoices (ignored):', r.error.message); continue; }
      for (const row of (r.data || []) as unknown as Record<string, unknown>[]) {
        if (!listingInvoices.some((x) => x.id === row.id)) listingInvoices.push(row);
      }
    }

    const all = [...dealInvoices, ...listingInvoices];
    // The agent's own records of the deal's people are not coordinator invoices.
    const owners = await invoiceOwners(all.map((i) => i.agent_id as string));
    const invoices = all
      .filter((i) => owners.get(i.agent_id as string) && owners.get(i.agent_id as string) !== user.id)
      .sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date)));
    if (invoices.length === 0) {
      return NextResponse.json([]);
    }

    const invoiceTxIds = [...new Set(invoices.map((i) => i.transaction_id as string).filter(Boolean))];
    const invoiceListingIds = [...new Set(invoices.map((i) => i.listing_id as string).filter(Boolean))];
    const [{ data: transactions }, { data: listingRows }] = await Promise.all([
      invoiceTxIds.length ? supabaseServer.from('transactions').select('id, file_number, property_address').in('id', invoiceTxIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      invoiceListingIds.length ? supabaseServer.from('listings').select('id, property_address').in('id', invoiceListingIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);

    const tcUserIds = [...new Set(invoices.map((i) => owners.get(i.agent_id as string) as string))];
    const tcLabels = new Map<string, string>();
    const tcPayOnline = new Map<string, boolean>();
    await Promise.all(
      tcUserIds.map(async (tcId) => {
        const { data } = await supabaseServer.auth.admin.getUserById(tcId);
        const label = (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || 'Transaction coordinator';
        tcLabels.set(tcId, label);
        tcPayOnline.set(tcId, await isStripePayAvailable(tcId));
      })
    );

    const txById = new Map((transactions || []).map((t) => [t.id as string, t]));
    const listingById = new Map((listingRows || []).map((l) => [l.id as string, l]));

    const result = invoices.map(({ agent_id, ...inv }) => {
      const tx = txById.get(inv.transaction_id as string);
      const listing = listingById.get(inv.listing_id as string);
      const tcUserId = owners.get(agent_id as string) || '';
      const tcLabel = tcLabels.get(tcUserId) || 'Transaction coordinator';
      return {
        ...inv,
        payOnline: tcPayOnline.get(tcUserId) || false,
        transaction: tx ? { id: tx.id, fileNumber: tx.file_number, propertyAddress: tx.property_address, tcLabel } : null,
        listing: listing ? { id: listing.id, propertyAddress: listing.property_address, tcLabel } : null,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching agent invoices:', error);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}

/** Which account owns each invoice: the coordinator whose Agents record it is billed to. */
async function invoiceOwners(agentRecordIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(agentRecordIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data } = await supabaseServer.from('agents').select('id, tc_user_id').in('id', ids);
  return new Map((data || []).filter((a) => a.tc_user_id).map((a) => [a.id as string, a.tc_user_id as string]));
}
