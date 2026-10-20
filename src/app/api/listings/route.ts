import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { getVisibleTcUserIds } from '@/lib/team';
import { logAudit } from '@/lib/audit';
import { cleanMoney, cleanText, dueFromOffset, isIsoDate, loadTemplateSteps } from '@/lib/listings';

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} listings:`, error);
  return NextResponse.json({ error: `Failed to ${what} listings` }, { status: 500 });
}

// GET: every listing this TC (and their team) can see, with checklist progress and open offers.
export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    if (isAgentUser(user)) throw new AuthError('Not available', 403);
    const visible = await getVisibleTcUserIds(user.id);
    let q = supabaseServer.from('listings').select('*').order('created_at', { ascending: false }).limit(500);
    if (!isAdmin) q = q.in('tc_user_id', visible);
    const { data: listings, error } = await q;
    if (error) throw error;
    const ids = (listings || []).map((l) => l.id as string);
    const agentIds = [...new Set((listings || []).map((l) => l.agent_id as string | null).filter(Boolean) as string[])];

    const [{ data: tasks }, { data: offers }, { data: agents }] = await Promise.all([
      ids.length ? supabaseServer.from('listing_tasks').select('listing_id, completed, due_date').in('listing_id', ids).limit(20000) : Promise.resolve({ data: [] }),
      ids.length ? supabaseServer.from('listing_offers').select('listing_id, status').in('listing_id', ids).limit(5000) : Promise.resolve({ data: [] }),
      agentIds.length ? supabaseServer.from('agents').select('id, name').in('id', agentIds) : Promise.resolve({ data: [] }),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const agentName = new Map((agents || []).map((a) => [a.id as string, a.name as string]));
    const result = (listings || []).map((l) => {
      const mine = (tasks || []).filter((t) => t.listing_id === l.id);
      const open = mine.filter((t) => !t.completed);
      const dueDates = open.map((t) => t.due_date as string | null).filter(Boolean) as string[];
      return {
        ...l,
        agent_name: l.agent_id ? agentName.get(l.agent_id as string) || null : null,
        tasks_total: mine.length,
        tasks_done: mine.length - open.length,
        overdue_count: dueDates.filter((d) => d < today).length,
        next_due_date: dueDates.sort()[0] || null,
        open_offers: (offers || []).filter((o) => o.listing_id === l.id && (o.status === 'received' || o.status === 'countered')).length,
      };
    });
    return NextResponse.json(result);
  } catch (error) {
    return fail(error, 'load');
  }
}

// POST: create a listing with its starter checklist (this TC's saved template, else Relay's).
export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    if (isAgentUser(user)) throw new AuthError('Not available', 403);
    await assertTrialActive(user);
    const body = await request.json().catch(() => ({}));

    const address = cleanText(body.propertyAddress, 300);
    if (!address) return NextResponse.json({ error: 'Property address is required' }, { status: 400 });
    const planned = isIsoDate(body.plannedListDate) ? body.plannedListDate : null;
    const expiration = isIsoDate(body.expirationDate) ? body.expirationDate : null;
    const sellerEmail = cleanText(body.sellerEmail, 254)?.toLowerCase() ?? null;

    let agentId: string | null = null;
    if (typeof body.agentId === 'string' && body.agentId) {
      const visible = await getVisibleTcUserIds(user.id);
      const { data: agent } = await supabaseServer.from('agents').select('id, tc_user_id').eq('id', body.agentId).maybeSingle();
      if (!agent || (!isAdmin && !visible.includes(agent.tc_user_id as string))) {
        return NextResponse.json({ error: 'Agent not found or does not belong to you' }, { status: 403 });
      }
      agentId = agent.id as string;
    }

    const { data: listing, error } = await supabaseServer
      .from('listings')
      .insert({
        tc_user_id: user.id,
        agent_id: agentId,
        property_address: address,
        seller_name: cleanText(body.sellerName, 200),
        seller_email: sellerEmail,
        seller_phone: cleanText(body.sellerPhone, 40),
        list_price: cleanMoney(body.listPrice),
        planned_list_date: planned,
        expiration_date: expiration,
        mls_number: cleanText(body.mlsNumber, 60),
        status: 'preparing',
      })
      .select('*')
      .single();
    if (error) throw error;

    const steps = await loadTemplateSteps(user.id);
    const rows = steps.map((s, i) => ({
      listing_id: listing.id,
      name: s.name,
      offset_days: s.offsetDays,
      due_date: dueFromOffset(planned, s.offsetDays),
      sort_order: i,
    }));
    if (rows.length) {
      const { error: tErr } = await supabaseServer.from('listing_tasks').insert(rows);
      if (tErr) throw tErr;
    }

    // The seller is also a contact on this listing.
    if (listing.seller_name || listing.seller_email) {
      await supabaseServer.from('listing_contacts').insert({
        listing_id: listing.id,
        role: 'Seller',
        name: listing.seller_name,
        email: listing.seller_email,
        phone: listing.seller_phone,
        position: 0,
      });
    }

    await logAudit(request, user, 'listing.create', { entityType: 'listing', entityId: listing.id });
    return NextResponse.json(listing, { status: 201 });
  } catch (error) {
    return fail(error, 'create');
  }
}
