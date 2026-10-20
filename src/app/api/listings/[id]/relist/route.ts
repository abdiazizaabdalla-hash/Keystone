import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAudit } from '@/lib/audit';
import { queueListingCalendarSync } from '@/lib/calendarSync';
import { cleanMoney, cleanTemplateName, dueFromOffset, isIsoDate, loadTemplateSteps, logListingActivity, requireListingAccess } from '@/lib/listings';

// Start a fresh listing from one that expired or was withdrawn: same property, seller, agent and people, a new
// checklist counted from a new planned list date, and a link back in the notes. The old listing stays as it
// was (its offers, showings and history are not copied). The new listing keeps the old one's "share with the agent" choice.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, listing } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    if (listing.status !== 'expired' && listing.status !== 'withdrawn') {
      return NextResponse.json({ error: 'Only an expired or withdrawn listing can be relisted' }, { status: 400 });
    }
    const ok = await checkRateLimit(`listing-relist:${user.id}`, 20, 60 * 60);
    if (!ok) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });

    const body = await request.json().catch(() => ({}));
    const planned = isIsoDate(body.plannedListDate) ? body.plannedListDate : null;
    const newPrice = cleanMoney(body.listPrice);
    const note = `Relisted from the ${listing.status === 'expired' ? 'expired' : 'withdrawn'} listing at ${listing.property_address}${listing.mls_number ? ` (MLS ${listing.mls_number})` : ''}.`;

    const { data: created, error } = await supabaseServer
      .from('listings')
      .insert({
        tc_user_id: listing.tc_user_id,
        agent_id: listing.agent_id,
        property_address: listing.property_address,
        seller_name: listing.seller_name,
        seller_email: listing.seller_email,
        seller_phone: listing.seller_phone,
        list_price: newPrice ?? listing.list_price,
        planned_list_date: planned,
        notes: [note, listing.notes].filter(Boolean).join('\n\n').slice(0, 4000),
        status: 'preparing',
        share_with_agent: listing.share_with_agent !== false,
      })
      .select('*')
      .single();
    if (error) throw error;

    const steps = await loadTemplateSteps(listing.tc_user_id as string, cleanTemplateName(body.templateName));
    const rows = steps.map((s, i) => ({ listing_id: created.id, name: s.name, offset_days: s.offsetDays, due_date: dueFromOffset(planned, s.offsetDays), sort_order: i }));
    if (rows.length) {
      const { error: tErr } = await supabaseServer.from('listing_tasks').insert(rows);
      if (tErr) throw tErr;
    }
    const { data: people } = await supabaseServer.from('listing_contacts').select('role, name, email, phone').eq('listing_id', id).order('position', { ascending: true }).limit(60);
    if (people && people.length) {
      await supabaseServer.from('listing_contacts').insert(people.map((p, i) => ({ ...p, listing_id: created.id, position: i })));
    }

    await logListingActivity(created.id as string, user, 'Listing created by relisting');
    await logListingActivity(id, user, 'Relisted as a new listing');
    queueListingCalendarSync(created.id as string);
    await logAudit(request, user, 'listing.relist', { entityType: 'listing', entityId: created.id, metadata: { from: id } });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error relisting:', error);
    return NextResponse.json({ error: 'Failed to relist' }, { status: 500 });
  }
}
