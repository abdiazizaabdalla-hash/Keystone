import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { getVisibleTcUserIds } from '@/lib/team';
import { logAudit } from '@/lib/audit';
import {
  LISTING_STATUSES,
  cleanMoney,
  cleanText,
  dueFromOffset,
  isIsoDate,
  requireListingAccess,
  type ListingStatus,
} from '@/lib/listings';

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} listing:`, error);
  return NextResponse.json({ error: `Failed to ${what} listing` }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { listing } = await requireListingAccess(request, id);
    const [tasks, offers, contacts, dates, agent] = await Promise.all([
      supabaseServer.from('listing_tasks').select('*').eq('listing_id', id).order('sort_order', { ascending: true }),
      supabaseServer.from('listing_offers').select('*').eq('listing_id', id).order('created_at', { ascending: false }),
      supabaseServer.from('listing_contacts').select('*').eq('listing_id', id).order('position', { ascending: true }),
      supabaseServer.from('listing_dates').select('*').eq('listing_id', id).order('due_date', { ascending: true }),
      listing.agent_id ? supabaseServer.from('agents').select('id, name, email, phone').eq('id', listing.agent_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    return NextResponse.json({
      listing,
      agent: agent.data,
      tasks: tasks.data || [],
      offers: offers.data || [],
      contacts: contacts.data || [],
      dates: dates.data || [],
    });
  } catch (error) {
    return fail(error, 'load');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, isAdmin, listing } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    const body = await request.json().catch(() => ({}));
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if ('propertyAddress' in body) {
      const v = cleanText(body.propertyAddress, 300);
      if (!v) return NextResponse.json({ error: 'Property address cannot be empty' }, { status: 400 });
      updates.property_address = v;
    }
    if ('sellerName' in body) updates.seller_name = cleanText(body.sellerName, 200);
    if ('sellerEmail' in body) updates.seller_email = cleanText(body.sellerEmail, 254)?.toLowerCase() ?? null;
    if ('sellerPhone' in body) updates.seller_phone = cleanText(body.sellerPhone, 40);
    if ('listPrice' in body) updates.list_price = cleanMoney(body.listPrice);
    if ('mlsNumber' in body) updates.mls_number = cleanText(body.mlsNumber, 60);
    if ('mlsUrl' in body) {
      const url = cleanText(body.mlsUrl, 500);
      if (url && !/^https?:\/\//i.test(url)) return NextResponse.json({ error: 'The MLS link must start with http:// or https://' }, { status: 400 });
      updates.mls_url = url;
    }
    if ('notes' in body) updates.notes = cleanText(body.notes, 4000);
    if ('expirationDate' in body) updates.expiration_date = isIsoDate(body.expirationDate) ? body.expirationDate : null;
    if ('status' in body) {
      if (!LISTING_STATUSES.includes(body.status as ListingStatus)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
      updates.status = body.status;
    }

    if ('agentId' in body) {
      if (!body.agentId) updates.agent_id = null;
      else {
        const visible = await getVisibleTcUserIds(user.id);
        const { data: agent } = await supabaseServer.from('agents').select('id, tc_user_id').eq('id', body.agentId).maybeSingle();
        if (!agent || (!isAdmin && !visible.includes(agent.tc_user_id as string))) {
          return NextResponse.json({ error: 'Agent not found or does not belong to you' }, { status: 403 });
        }
        updates.agent_id = agent.id;
      }
    }

    // Linking the deal this listing became (after "Convert to deal"). Must be a deal this TC can see.
    if ('convertedTransactionId' in body && body.convertedTransactionId) {
      const { data: tx } = await supabaseServer.from('transactions').select('id, agent_id').eq('id', body.convertedTransactionId).maybeSingle();
      if (!tx) return NextResponse.json({ error: 'Deal not found' }, { status: 400 });
      if (!isAdmin) {
        const visible = await getVisibleTcUserIds(user.id);
        const { data: agent } = await supabaseServer.from('agents').select('tc_user_id').eq('id', tx.agent_id).maybeSingle();
        if (!agent || !visible.includes(agent.tc_user_id as string)) return NextResponse.json({ error: 'Deal not found' }, { status: 400 });
      }
      updates.converted_transaction_id = tx.id;
      updates.status = 'converted';
    }

    const newPlanned = 'plannedListDate' in body ? (isIsoDate(body.plannedListDate) ? body.plannedListDate : null) : undefined;
    if (newPlanned !== undefined) updates.planned_list_date = newPlanned;

    const { data, error } = await supabaseServer.from('listings').update(updates).eq('id', id).select('*').single();
    if (error) throw error;

    // Moving the planned list date moves every unfinished step that is tied to it.
    if (newPlanned !== undefined && newPlanned !== listing.planned_list_date) {
      const { data: tasks } = await supabaseServer.from('listing_tasks').select('id, offset_days').eq('listing_id', id).eq('completed', false);
      for (const t of tasks || []) {
        if (t.offset_days === null || t.offset_days === undefined) continue;
        await supabaseServer.from('listing_tasks').update({ due_date: dueFromOffset(newPlanned, t.offset_days as number) }).eq('id', t.id);
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    return fail(error, 'update');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, listing } = await requireListingAccess(request, id);
    if (listing.tc_user_id !== user.id) {
      return NextResponse.json({ error: 'Only the person who created this listing can delete it' }, { status: 403 });
    }
    // Remove the stored files too; the document rows go with the listing, but storage objects would be orphaned.
    const { data: docs } = await supabaseServer.from('listing_documents').select('storage_path').eq('listing_id', id);
    const { error } = await supabaseServer.from('listings').delete().eq('id', id);
    if (error) throw error;
    const paths = (docs || []).map((d) => d.storage_path as string).filter(Boolean);
    if (paths.length > 0) await supabaseServer.storage.from('transaction-documents').remove(paths).catch(() => undefined);
    await logAudit(request, user, 'listing.delete', { entityType: 'listing', entityId: id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, 'delete');
  }
}
