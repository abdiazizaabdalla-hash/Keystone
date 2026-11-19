import { cleanServices } from '@/lib/agentServices';
import { notifyDealOwnerOfInvoice } from '@/lib/coordinatorInvoiceNotify';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { logAudit } from '@/lib/audit';
import { queueQuickBooksSync } from '@/lib/quickbooksSync';
import { isFullParticipant } from '@/lib/authorize';
import { agentProfileForSharedDeal } from '@/lib/coordinatorOnboarding';
import { InvoiceEditError, resolveInvoiceAmounts, round2 } from '@/lib/invoiceBreakdown';

export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const agentId = request.nextUrl.searchParams.get('agentId');
    const transactionId = request.nextUrl.searchParams.get('transactionId');
    const paidStatus = request.nextUrl.searchParams.get('paid');

    let userAgentIds: string[] = [];
    if (!isAdmin) {
      const { data: agents } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('tc_user_id', user.id);
      userAgentIds = agents?.map((a) => a.id) || [];
    }

    let query = supabaseServer
      .from('invoices')
      .select('*')
      .order('invoice_date', { ascending: false });

    if (agentId) {
      // A caller-supplied agentId must still be one of THIS caller's own
      // agents -- without this check, any authenticated user could read
      // another TC's invoices (amounts, commission %, property address)
      // just by guessing/passing a different agentId. Found during the
      // 2026-09 security audit.
      if (!isAdmin && !userAgentIds.includes(agentId)) {
        return NextResponse.json({ error: 'Agent not found or does not belong to you' }, { status: 403 });
      }
      query = query.eq('agent_id', agentId);
    } else if (!isAdmin) {
      if (userAgentIds.length === 0) {
        return NextResponse.json([]);
      }
      query = query.in('agent_id', userAgentIds);
    }

    if (transactionId) {
      query = query.eq('transaction_id', transactionId);
    }

    if (paidStatus !== null) {
      const isPaid = paidStatus === 'true';
      query = query.eq('paid', isPaid);
    }

    const { data: invoiceRows, error } = await query;

    if (error) throw error;

    const invoiceList = invoiceRows || [];

    // Attach agent + transaction details manually — the invoices table has no
    // FK constraints to agents/transactions, so PostgREST's embedded-join
    // syntax (agent:agents(...)) can't resolve the relationship.
    const agentIds = [...new Set(invoiceList.map((i: any) => i.agent_id).filter(Boolean))];
    const transactionIds = [...new Set(invoiceList.map((i: any) => i.transaction_id).filter(Boolean))];

    // Listing invoices have no transaction: show the listing in its place.
    const listingIds = [...new Set(invoiceList.map((i: any) => i.listing_id).filter(Boolean))];
    const listingsResult = listingIds.length
      ? await supabaseServer.from('listings').select('id, property_address, list_price').in('id', listingIds)
      : { data: [] as any[] };
    const listingMap = new Map((listingsResult.data || []).map((l: any) => [l.id, l]));

    const [agentsResult, transactionsResult] = await Promise.all([
      agentIds.length
        ? supabaseServer.from('agents').select('id, name, brokerage, email, commission_percent, flat_fee').in('id', agentIds)
        : Promise.resolve({ data: [] as any[] }),
      transactionIds.length
        ? supabaseServer.from('transactions').select('id, file_number, property_address, purchase_price').in('id', transactionIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const agentMap = new Map((agentsResult.data || []).map((a: any) => [a.id, a]));
    const transactionMap = new Map((transactionsResult.data || []).map((t: any) => [t.id, t]));

    const data = invoiceList.map((inv: any) => ({
      ...inv,
      agent: agentMap.get(inv.agent_id) || null,
      transaction:
        transactionMap.get(inv.transaction_id) ||
        (inv.listing_id && listingMap.get(inv.listing_id)
          ? {
              id: inv.listing_id,
              file_number: 'Listing',
              property_address: (listingMap.get(inv.listing_id) as any).property_address,
              purchase_price: Number((listingMap.get(inv.listing_id) as any).list_price) || 0,
              isListing: true,
            }
          : null),
    }));

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching invoices:', error);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const body = await request.json();
    const { agentId, transactionId, purchasePrice } = body;

    if (body.kind === 'listing') {
      return await createListingInvoice(request, user, isAdmin, body);
    }

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    // Commission % always comes from the agent's own settings (Agents
    // page), never from the client -- invoices are always created this
    // way, by the TC's own click, on every plan.
    let effectiveAgentId = agentId;
    let { data: agentRecord } = await supabaseServer
      .from('agents')
      .select('id, flat_fee, commission_percent, tc_user_id')
      .eq('id', effectiveAgentId)
      .single();

    // A deal an agent shared with this coordinator: it is billed to the coordinator's own record for that agent, at their fees.
    let sharedDeal = false;
    if (!isAdmin && (!agentRecord || agentRecord.tc_user_id !== user.id) && (await isFullParticipant(user.id, transactionId))) {
      const profile = await agentProfileForSharedDeal(user, transactionId, { create: true });
      if (profile) {
        const { data: own } = await supabaseServer.from('agents').select('id, flat_fee, commission_percent, tc_user_id').eq('id', profile.id).single();
        if (own && own.tc_user_id === user.id) {
          agentRecord = own;
          effectiveAgentId = own.id as string;
          sharedDeal = true;
        }
      }
    }

    if (!isAdmin) {
      if (!agentRecord || agentRecord.tc_user_id !== user.id) {
        return NextResponse.json({ error: 'Agent not found or does not belong to you' }, { status: 403 });
      }

      // The transaction has to belong to that agent. Without this, any TC
      // could invoice (and then email the documents of) someone else's
      // transaction by pairing their own agent with a foreign transactionId.
      const { data: txRow } = await supabaseServer
        .from('transactions')
        .select('id, agent_id')
        .eq('id', transactionId)
        .maybeSingle();
      // A deal shared with this coordinator is billed to their own record for the deal's agent (not the record the deal points at).
      let billsSharedDeal = sharedDeal;
      if (txRow && !billsSharedDeal && txRow.agent_id !== effectiveAgentId && (await isFullParticipant(user.id, transactionId))) {
        const mine = await agentProfileForSharedDeal(user, transactionId, { create: false });
        billsSharedDeal = mine?.id === effectiveAgentId;
      }
      if (!txRow || (!billsSharedDeal && txRow.agent_id !== effectiveAgentId)) {
        return NextResponse.json({ error: 'Transaction not found or does not belong to this agent' }, { status: 403 });
      }
    }

    // One invoice per transaction -- a direct user action, so a repeat
    // attempt gets a clear error instead of silently no-oping.
    const { data: existingInvoice } = await supabaseServer
      .from('invoices')
      .select('id')
      .eq('transaction_id', transactionId)
      .eq('agent_id', effectiveAgentId)
      .maybeSingle();

    if (existingInvoice) {
      return NextResponse.json(
        { error: 'This transaction already has an invoice.', code: 'invoice_exists' },
        { status: 409 }
      );
    }

    let dueDays = 30;
    if (agentRecord?.tc_user_id) {
      const { data: tcUser } = await supabaseServer.auth.admin.getUserById(agentRecord.tc_user_id);
      const configured = tcUser?.user?.user_metadata?.invoice_due_days;
      if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
        dueDays = configured;
      }
    }

    // Calculate total: flat fee + optional percentage-based fee (agent's
    // own commission_percent, not anything client-supplied -- see above).
    // The price comes from the page when it sends one, otherwise from the deal itself (never NaN: a missing price would make the amount null).
    let price = Number(purchasePrice);
    if (purchasePrice === undefined || purchasePrice === null || purchasePrice === '' || !Number.isFinite(price)) {
      const { data: priceRow } = await supabaseServer.from('transactions').select('purchase_price').eq('id', transactionId).maybeSingle();
      price = Number(priceRow?.purchase_price);
      if (!Number.isFinite(price)) price = 0;
    }
    const percentageFeeAmount = round2((price * (agentRecord?.commission_percent || 0)) / 100);
    const defaults = { flatFee: round2(Number(agentRecord?.flat_fee) || 0), percentFee: percentageFeeAmount };

    // The screen that asks the coordinator to confirm the details before anything is created.
    if (body.preview === true) {
      const [{ data: pAgent }, { data: pTx }] = await Promise.all([
        supabaseServer.from('agents').select('*').eq('id', effectiveAgentId).maybeSingle(),
        supabaseServer.from('transactions').select('property_address, file_number').eq('id', transactionId).maybeSingle(),
      ]);
      return NextResponse.json({
        preview: true,
        kind: 'transaction',
        agent: { name: pAgent?.name ?? '', email: pAgent?.email ?? null },
        property: pTx?.property_address ?? '',
        fileNumber: pTx?.file_number ?? null,
        purchasePrice: price,
        percentRate: Number(pAgent?.commission_percent) || 0,
        defaults,
        services: cleanServices(pAgent?.services),
        otherFee: Number(pAgent?.listing_fee) > 0 ? round2(Number(pAgent?.listing_fee)) : null,
        dueDays,
      });
    }

    let amounts;
    try {
      amounts = resolveInvoiceAmounts(defaults, body.edits);
    } catch (e) {
      if (e instanceof InvoiceEditError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
    const totalAmount = amounts.total;

    // Generate invoice number (RELAY-YYYYMMDD-XXXXX)
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');

    // Get count of invoices created today to generate sequential number
    const { data: todayInvoices, error: countError } = await supabaseServer
      .from('invoices')
      .select('id')
      .gte('invoice_date', today.toISOString().split('T')[0])
      .lt('invoice_date', new Date(today.getTime() + 86400000).toISOString().split('T')[0]);

    if (countError) throw countError;

    const invoiceNumber = `RELAY-${dateStr}-${String((todayInvoices?.length || 0) + 1).padStart(5, '0')}`;

    // Calculate due date (TC's configured default, or 30 days if unset)
    const dueDate = new Date(today.getTime() + dueDays * 24 * 60 * 60 * 1000);

    // Create invoice
    const { data: invoice, error: invoiceError } = await supabaseServer
      .from('invoices')
      .insert({
        agent_id: effectiveAgentId,
        transaction_id: transactionId,
        amount_owed: totalAmount,
        invoice_number: invoiceNumber,
        invoice_date: today.toISOString(),
        due_date: dueDate.toISOString().split('T')[0],
        paid: false,
        // Only remembered when the coordinator changed something, so a plain invoice needs nothing new in the database.
        ...(amounts.edited
          ? {
              flat_fee: amounts.flatFee,
              percent_fee: amounts.percentFee,
              adjustment: amounts.discount > 0 ? -amounts.discount : null,
              adjustment_note: amounts.discountNote || null,
              description: amounts.description || null,
            }
          : {}),
      })
      .select()
      .single();

    if (invoiceError) {
      if (amounts.edited && isMissingColumn(invoiceError)) return NextResponse.json({ error: UPDATE_NEEDED }, { status: 500 });
      throw invoiceError;
    }

    await logAudit(request, user, 'invoice.create', { entityType: 'invoice', entityId: invoice.id });
    await notifyDealOwnerOfInvoice({ transactionId, actor: user, invoiceNumber: invoiceNumber, amount: totalAmount, kind: 'created' });
    queueQuickBooksSync(invoice.id); // no-op unless this TC connected QuickBooks
    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TrialExpiredError) {
      return NextResponse.json(
        { error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt },
        { status: error.status }
      );
    }
    console.error('Error creating invoice:', error);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}

const UPDATE_NEEDED = 'The database needs its latest update (add-listing-invoices.sql) before invoices can be edited or created for a listing.';
function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || '');
}

async function nextInvoiceNumber(today: Date): Promise<string> {
  const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
  const { data: todayInvoices, error } = await supabaseServer
    .from('invoices')
    .select('id')
    .gte('invoice_date', today.toISOString().split('T')[0])
    .lt('invoice_date', new Date(today.getTime() + 86400000).toISOString().split('T')[0]);
  if (error) throw error;
  return `RELAY-${dateStr}-${String((todayInvoices?.length || 0) + 1).padStart(5, '0')}`;
}

// An invoice for listing a property (no deal yet). The fee starts at the agent's listing fee and the coordinator confirms or changes it.
async function createListingInvoice(request: NextRequest, user: { id: string }, isAdmin: boolean, body: Record<string, unknown>) {
  const listingId = typeof body.listingId === 'string' ? body.listingId : '';
  if (!listingId) return NextResponse.json({ error: 'listingId is required' }, { status: 400 });

  const { data: listing } = await supabaseServer.from('listings').select('id, tc_user_id, agent_id, property_address, list_price').eq('id', listingId).maybeSingle();
  if (!listing || (!isAdmin && listing.tc_user_id !== user.id)) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  if (!listing.agent_id) return NextResponse.json({ error: 'Choose the agent for this listing before invoicing it.', code: 'no_agent' }, { status: 400 });

  const { data: agent } = await supabaseServer.from('agents').select('*').eq('id', listing.agent_id).maybeSingle();
  if (!agent || (!isAdmin && agent.tc_user_id !== user.id)) return NextResponse.json({ error: 'Agent not found or does not belong to you' }, { status: 403 });

  const { data: existing, error: existingError } = await supabaseServer.from('invoices').select('id').eq('listing_id', listingId).eq('agent_id', agent.id).maybeSingle();
  if (existingError && isMissingColumn(existingError)) return NextResponse.json({ error: UPDATE_NEEDED }, { status: 500 });
  if (existing) return NextResponse.json({ error: 'This listing already has an invoice.', code: 'invoice_exists', invoiceId: existing.id }, { status: 409 });

  let dueDays = 30;
  const { data: tcUser } = await supabaseServer.auth.admin.getUserById(agent.tc_user_id as string);
  const configured = tcUser?.user?.user_metadata?.invoice_due_days;
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) dueDays = configured;

  const defaults = { flatFee: round2(Number(agent.listing_fee) || 0), percentFee: 0 };
  if (body.preview === true) {
    return NextResponse.json({
      preview: true,
      kind: 'listing',
      agent: { name: agent.name ?? '', email: agent.email ?? null },
      property: listing.property_address ?? '',
      fileNumber: null,
      purchasePrice: Number(listing.list_price) || 0,
      percentRate: 0,
      defaults,
      services: cleanServices(agent.services),
      otherFee: Number(agent.flat_fee) > 0 ? round2(Number(agent.flat_fee)) : null,
      dueDays,
    });
  }

  let amounts;
  try {
    amounts = resolveInvoiceAmounts(defaults, body.edits as never);
  } catch (e) {
    if (e instanceof InvoiceEditError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  if (!(amounts.total > 0)) return NextResponse.json({ error: 'Enter the listing fee to charge before creating the invoice.' }, { status: 400 });

  const today = new Date();
  const invoiceNumber = await nextInvoiceNumber(today);
  const dueDate = new Date(today.getTime() + dueDays * 24 * 60 * 60 * 1000);
  const { data: invoice, error } = await supabaseServer
    .from('invoices')
    .insert({
      agent_id: agent.id,
      transaction_id: null,
      kind: 'listing',
      listing_id: listingId,
      amount_owed: amounts.total,
      invoice_number: invoiceNumber,
      invoice_date: today.toISOString(),
      due_date: dueDate.toISOString().split('T')[0],
      paid: false,
      flat_fee: amounts.flatFee,
      percent_fee: 0,
      adjustment: amounts.discount > 0 ? -amounts.discount : null,
      adjustment_note: amounts.discountNote || null,
      description: amounts.description || null,
    })
    .select()
    .single();
  if (error) {
    if (isMissingColumn(error)) return NextResponse.json({ error: UPDATE_NEEDED }, { status: 500 });
    throw error;
  }
  await logAudit(request, user as never, 'invoice.create', { entityType: 'invoice', entityId: invoice.id });
  queueQuickBooksSync(invoice.id);
  return NextResponse.json(invoice, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const body = await request.json();
    const { invoiceId, paid, paidAmount, dueDate } = body;

    if (!isAdmin) {
      const { data: invoice } = await supabaseServer
        .from('invoices')
        .select('agent_id')
        .eq('id', invoiceId)
        .single();

      if (!invoice) {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }

      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', invoice.agent_id)
        .eq('tc_user_id', user.id)
        .single();

      if (!agent) {
        return NextResponse.json({ error: 'You do not have permission to update this invoice' }, { status: 403 });
      }
    }

    const updateData: any = {};
    if (paid !== undefined) {
      updateData.paid = paid;
      if (paid) {
        updateData.paid_at = new Date().toISOString();
        updateData.paid_amount = paidAmount || null;
      } else {
        updateData.paid_at = null;
        updateData.paid_amount = null;
      }
    }

    if (dueDate !== undefined) {
      const parsed = new Date(dueDate);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'dueDate must be a valid date' }, { status: 400 });
      }
      updateData.due_date = parsed.toISOString().split('T')[0];
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: before } = await supabaseServer.from('invoices').select('paid').eq('id', invoiceId).maybeSingle();

    const { data: updatedInvoice, error } = await supabaseServer
      .from('invoices')
      .update(updateData)
      .eq('id', invoiceId)
      .select()
      .single();

    if (error) throw error;

    if (paid === true) queueQuickBooksSync(updatedInvoice.id); // record the payment in QuickBooks, if connected
    if (paid === true && before && !before.paid && updatedInvoice.transaction_id) {
      await notifyDealOwnerOfInvoice({ transactionId: updatedInvoice.transaction_id, actor: user, invoiceNumber: updatedInvoice.invoice_number, amount: Number(updatedInvoice.amount_owed) || 0, kind: 'paid' });
    }

    const [{ data: agentRow }, { data: transactionRow }] = await Promise.all([
      updatedInvoice.agent_id
        ? supabaseServer.from('agents').select('id, name, brokerage, email, commission_percent, flat_fee').eq('id', updatedInvoice.agent_id).single()
        : Promise.resolve({ data: null }),
      updatedInvoice.transaction_id
        ? supabaseServer.from('transactions').select('id, file_number, property_address, purchase_price').eq('id', updatedInvoice.transaction_id).single()
        : Promise.resolve({ data: null }),
    ]);

    const data = { ...updatedInvoice, agent: agentRow || null, transaction: transactionRow || null };

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TrialExpiredError) {
      return NextResponse.json(
        { error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt },
        { status: error.status }
      );
    }
    console.error('Error updating invoice:', error);
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}
export async function DELETE(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 });
    }

    const { data: invoice, error: fetchError } = await supabaseServer
      .from('invoices')
      .select('id, agent_id')
      .eq('id', id)
      .single();

    if (fetchError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (!isAdmin) {
      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', invoice.agent_id)
        .eq('tc_user_id', user.id)
        .single();

      if (!agent) {
        return NextResponse.json({ error: 'You do not have permission to delete this invoice' }, { status: 403 });
      }
    }

    const { error: deleteError } = await supabaseServer
      .from('invoices')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    await logAudit(request, user, 'invoice.delete', { entityType: 'invoice', entityId: id });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error deleting invoice:', error);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }
}
