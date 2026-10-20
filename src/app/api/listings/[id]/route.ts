import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { getVisibleTcUserIds } from '@/lib/team';
import { logAudit } from '@/lib/audit';
import { offerDocPaths } from '@/lib/listingOfferFiles';
import { queueListingCalendarSync, removeListingCalendarEvents } from '@/lib/calendarSync';
import { isAgentUser } from '@/lib/agentPortal';
import { removeInboundFiles } from '@/lib/listingInbound';
import { sendListingPortalInvite } from '@/lib/agentInvite';
import { REQUIRED_LISTING_DOCS } from '@/lib/listingReadiness';
import {
  LISTING_STATUSES,
  cleanMoney,
  cleanText,
  dueFromOffset,
  isIsoDate,
  logListingActivity,
  requireListingAccess,
  type ListingStatus,
} from '@/lib/listings';

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} listing:`, error);
  return NextResponse.json({ error: `Failed to ${what} listing` }, { status: 500 });
}

async function userLabel(userId: string): Promise<string> {
  const { data } = await supabaseServer.auth.admin.getUserById(userId);
  const name = typeof data.user?.user_metadata?.full_name === 'string' ? data.user.user_metadata.full_name.trim() : '';
  return name || data.user?.email || 'Team member';
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, isAdmin, listing } = await requireListingAccess(request, id);
    const [tasks, offers, contacts, dates, agent, showings, priceChanges, activity] = await Promise.all([
      supabaseServer.from('listing_tasks').select('*').eq('listing_id', id).order('sort_order', { ascending: true }),
      supabaseServer.from('listing_offers').select('*').eq('listing_id', id).order('created_at', { ascending: false }),
      supabaseServer.from('listing_contacts').select('*').eq('listing_id', id).order('position', { ascending: true }),
      supabaseServer.from('listing_dates').select('*').eq('listing_id', id).order('due_date', { ascending: true }),
      listing.agent_id ? supabaseServer.from('agents').select('id, name, email, phone').eq('id', listing.agent_id).maybeSingle() : Promise.resolve({ data: null }),
      supabaseServer.from('listing_showings').select('*').eq('listing_id', id).order('showing_date', { ascending: false }),
      supabaseServer.from('listing_price_changes').select('*').eq('listing_id', id).order('changed_on', { ascending: true }).order('created_at', { ascending: true }),
      supabaseServer.from('listing_activity').select('*').eq('listing_id', id).order('created_at', { ascending: false }).limit(60),
    ]);
    // Who this listing can be handed to: only the owner of a team sees more than themselves.
    let assignees: { id: string; label: string }[] = [];
    if (!isAdmin) {
      const visible = await getVisibleTcUserIds(user.id);
      if (visible.length > 1) assignees = await Promise.all(visible.map(async (uid) => ({ id: uid, label: await userLabel(uid) })));
    }
    return NextResponse.json({
      listing,
      assignees,
      agent: agent.data,
      tasks: tasks.data || [],
      offers: offers.data || [],
      contacts: contacts.data || [],
      dates: dates.data || [],
      // These come from add-listing-extras.sql; before it is run they are simply empty.
      showings: showings.data || [],
      priceChanges: priceChanges.data || [],
      activity: activity.data || [],
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
    if ('shareWithAgent' in body) updates.share_with_agent = body.shareWithAgent === true;
    if ('notifyAgent' in body) updates.notify_agent = body.notifyAgent === true;
    if ('docsNotNeeded' in body) {
      const list = Array.isArray(body.docsNotNeeded) ? body.docsNotNeeded : [];
      updates.docs_not_needed = REQUIRED_LISTING_DOCS.filter((t) => list.includes(t));
    }
    if ('listedOn' in body) updates.listed_on = isIsoDate(body.listedOn) ? body.listedOn : null;
    // The first time a listing goes live starts its days-on-market clock (a typed date above wins).
    if ((updates.status === 'active' || updates.status === 'under_offer') && !listing.listed_on && !('listed_on' in updates)) {
      updates.listed_on = new Date().toISOString().slice(0, 10);
    }

    // Hand the listing to another TC on the same team. Only a team owner can (everyone else sees only themselves),
    // and the new owner must be a real, non-agent member of that team.
    let reassignedTo: string | null = null;
    if (typeof body.tcUserId === 'string' && body.tcUserId && body.tcUserId !== listing.tc_user_id) {
      const visible = await getVisibleTcUserIds(user.id);
      if (!isAdmin && !visible.includes(body.tcUserId)) return NextResponse.json({ error: 'You can only hand a listing to someone on your team' }, { status: 403 });
      const { data: target } = await supabaseServer.auth.admin.getUserById(body.tcUserId);
      if (!target.user || isAgentUser(target.user)) return NextResponse.json({ error: 'That person cannot be assigned listings' }, { status: 400 });
      reassignedTo = await userLabel(body.tcUserId);
      updates.tc_user_id = body.tcUserId;
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
      if (listing.converted_transaction_id && listing.converted_transaction_id !== body.convertedTransactionId) {
        return NextResponse.json({ error: 'This listing has already been turned into a deal.', code: 'already_converted', existing: { id: listing.converted_transaction_id } }, { status: 409 });
      }
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

    // Calendar events live on the old owner's Google calendar; remove them before the listing moves.
    if (reassignedTo) await removeListingCalendarEvents(id);
    let { data, error } = await supabaseServer.from('listings').update(updates).eq('id', id).select('*').single();
    if (error && /listed_on|notify_agent|docs_not_needed/.test(error.message || '')) {
      // add-listing-round3.sql / add-listing-readiness.sql has not been run yet: save everything else.
      delete updates.listed_on;
      delete updates.notify_agent;
      delete updates.docs_not_needed;
      ({ data, error } = await supabaseServer.from('listings').update(updates).eq('id', id).select('*').single());
    }
    if (error) throw error;
    if (reassignedTo) {
      await supabaseServer.from('listing_tasks').update({ google_event_id: null }).eq('listing_id', id);
      await supabaseServer.from('listing_dates').update({ google_event_id: null }).eq('listing_id', id);
      await supabaseServer.from('listings').update({ google_expiration_event_id: null }).eq('id', id);
      await logListingActivity(id, user, `Listing handed to ${reassignedTo}`);
    }

    // History: status moves, price changes (also kept as a price history), key date changes.
    const fmt = (n: unknown) => `$${Number(n).toLocaleString('en-US')}`;
    if (updates.status && updates.status !== listing.status) {
      await logListingActivity(id, user, `Status changed from ${listing.status} to ${updates.status}`);
    }
    if ('list_price' in updates && updates.list_price !== null && Number(updates.list_price) !== Number(listing.list_price)) {
      const priceNote = typeof body.priceNote === 'string' ? cleanText(body.priceNote, 500) : null;
      if (listing.list_price) {
        await supabaseServer
          .from('listing_price_changes')
          .insert({ listing_id: id, old_price: listing.list_price, new_price: updates.list_price, changed_on: new Date().toISOString().split('T')[0], note: priceNote });
        await logListingActivity(id, user, `List price changed from ${fmt(listing.list_price)} to ${fmt(updates.list_price)}${priceNote ? ` (${priceNote})` : ''}`);
      } else {
        await logListingActivity(id, user, `List price set to ${fmt(updates.list_price)}`);
      }
    }
    if ('expiration_date' in updates && updates.expiration_date !== listing.expiration_date) {
      await logListingActivity(id, user, updates.expiration_date ? `Listing expiration set to ${updates.expiration_date}` : 'Listing expiration cleared');
    }
    if (newPlanned !== undefined && newPlanned !== listing.planned_list_date) {
      await logListingActivity(id, user, newPlanned ? `Planned list date set to ${newPlanned}` : 'Planned list date cleared');
    }

    // Moving the planned list date moves every unfinished step that is tied to it.
    if (newPlanned !== undefined && newPlanned !== listing.planned_list_date) {
      const { data: tasks } = await supabaseServer.from('listing_tasks').select('id, offset_days').eq('listing_id', id).eq('completed', false);
      for (const t of tasks || []) {
        if (t.offset_days === null || t.offset_days === undefined) continue;
        await supabaseServer.from('listing_tasks').update({ due_date: dueFromOffset(newPlanned, t.offset_days as number) }).eq('id', t.id);
      }
    }

    queueListingCalendarSync(id);

    // A newly assigned agent, or sharing switched on, gets their portal login without anyone having to remember.
    // Only while the listing is still open, and never twice for the same agent.
    const agentChanged = 'agent_id' in updates && updates.agent_id && updates.agent_id !== listing.agent_id;
    const sharingTurnedOn = updates.share_with_agent === true && listing.share_with_agent !== true;
    if ((agentChanged || sharingTurnedOn) && data && ['preparing', 'active', 'under_offer'].includes(data.status as string)) {
      await sendListingPortalInvite({ listing: data, user, appUrl: request.nextUrl.origin, onlyIfNew: true });
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
    await removeListingCalendarEvents(id);
    // Remove the stored files too; the document rows go with the listing, but storage objects would be orphaned.
    const offerPathsToRemove = await offerDocPaths({ listingId: id });
    const { data: docs } = await supabaseServer.from('listing_documents').select('storage_path').eq('listing_id', id);
    // Offer emails held for review keep their files in storage; collect them before the rows cascade away.
    const { data: held } = await supabaseServer.from('listing_inbound_offers').select('attachments').eq('listing_id', id);
    // Signing requests go with the listing; collect their stored PDFs (partly-signed copies included) first.
    const { data: signingFiles } = await supabaseServer.from('signing_requests').select('signed_storage_path').eq('listing_id', id);
    const { error } = await supabaseServer.from('listings').delete().eq('id', id);
    if (error) throw error;
    for (const h of held || []) await removeInboundFiles(h.attachments);
    const paths = [
      ...(docs || []).map((d) => d.storage_path as string).filter(Boolean),
      ...(signingFiles || []).map((r) => r.signed_storage_path as string).filter(Boolean),
      ...offerPathsToRemove,
    ];
    if (paths.length > 0) await supabaseServer.storage.from('transaction-documents').remove(paths).catch(() => undefined);
    await logAudit(request, user, 'listing.delete', { entityType: 'listing', entityId: id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, 'delete');
  }
}
