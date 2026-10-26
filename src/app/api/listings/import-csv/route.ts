import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { getVisibleTcUserIds } from '@/lib/team';
import { logAudit } from '@/lib/audit';
import { sameProperty } from '@/lib/duplicates';
import { addDaysIso, cleanMoney, cleanText, isIsoDate, loadTemplateSteps, type ListingStatus } from '@/lib/listings';

const MAX_PER_REQUEST = 200;
const MAX_LISTINGS = 500;

function statusFrom(raw: unknown): ListingStatus {
  const v = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (/offer|pending|contingent|under contract/.test(v)) return 'under_offer';
  if (/active|live|on market|listed/.test(v)) return 'active';
  return 'preparing';
}

// Adds listings from a CSV the browser already read (rows of address / seller / price / dates / MLS #).
// Each one gets the starter checklist from this TC's saved template. A listing that is already on the market
// skips the "get ready to list" steps. The same property twice (already open, or twice in the file) is
// skipped. Nobody is emailed and no agent is invited by an import. The ids come back so the import can be
// undone for a couple of minutes (see ./undo/route.ts).
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) throw new AuthError('Not available', 403);
    await assertTrialActive(user);

    const body = await request.json().catch(() => ({}));
    const rows: unknown[] = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    if (rows.length > MAX_PER_REQUEST) return NextResponse.json({ error: `Import up to ${MAX_PER_REQUEST} listings at a time` }, { status: 400 });

    const visible = await getVisibleTcUserIds(user.id);
    const { data: existing } = await supabaseServer.from('listings').select('property_address, status').in('tc_user_id', visible).limit(2000);
    const open = (existing || []).filter((l) => ['preparing', 'active', 'under_offer'].includes(String(l.status)));
    const { count: mine } = await supabaseServer.from('listings').select('id', { count: 'exact', head: true }).eq('tc_user_id', user.id);
    if ((mine ?? 0) >= MAX_LISTINGS) return NextResponse.json({ error: `You have reached the ${MAX_LISTINGS} listing limit` }, { status: 400 });

    const today = new Date().toISOString().slice(0, 10);
    const toAdd: { status: ListingStatus; planned: string | null; listedOn: string | null; row: Record<string, unknown> }[] = [];
    const seen: string[] = [];
    let skippedDuplicate = 0;
    let skippedInvalid = 0;

    for (const raw of rows) {
      const r = (raw || {}) as Record<string, unknown>;
      const address = cleanText(r.propertyAddress, 300);
      if (!address) {
        skippedInvalid += 1;
        continue;
      }
      if (open.some((l) => sameProperty(l.property_address as string, address)) || seen.some((a) => sameProperty(a, address))) {
        skippedDuplicate += 1;
        continue;
      }
      if ((mine ?? 0) + toAdd.length >= MAX_LISTINGS) break;
      seen.push(address);

      const status = statusFrom(r.status);
      const planned = isIsoDate(r.plannedListDate) ? r.plannedListDate : null;
      const live = status !== 'preparing';
      const listedOn = live ? (planned && planned <= today ? planned : today) : null;
      toAdd.push({
        status,
        planned,
        listedOn,
        row: {
          tc_user_id: user.id,
          property_address: address,
          seller_name: cleanText(r.sellerName, 200),
          seller_email: cleanText(r.sellerEmail, 254)?.toLowerCase() ?? null,
          seller_phone: cleanText(r.sellerPhone, 40),
          list_price: cleanMoney(r.listPrice),
          planned_list_date: planned,
          expiration_date: isIsoDate(r.expirationDate) ? r.expirationDate : null,
          mls_number: cleanText(r.mlsNumber, 60),
          notes: cleanText(r.notes, 4000),
          status,
        },
      });
    }

    if (toAdd.length === 0) return NextResponse.json({ added: 0, ids: [], skippedDuplicate, skippedInvalid });

    // listed_on comes from a later update to the listings table; fall back without it if that isn't there yet.
    let inserted = await supabaseServer
      .from('listings')
      .insert(toAdd.map((a) => ({ ...a.row, ...(a.listedOn ? { listed_on: a.listedOn } : {}) })))
      .select('id');
    if (inserted.error && /listed_on/.test(inserted.error.message || '')) {
      inserted = await supabaseServer.from('listings').insert(toAdd.map((a) => a.row)).select('id');
    }
    if (inserted.error) throw inserted.error;
    const created = inserted.data || [];

    // Checklist and seller contact for each (best effort: a listing without them is still a valid listing).
    const steps = await loadTemplateSteps(user.id);
    const taskRows: Record<string, unknown>[] = [];
    const personRows: Record<string, unknown>[] = [];
    created.forEach((c, i) => {
      const a = toAdd[i];
      const base = a.listedOn ?? a.planned;
      steps.forEach((s, n) => {
        // A listing already on the market is past its preparation steps.
        if (a.status !== 'preparing' && s.offsetDays < 0) return;
        let due = base ? addDaysIso(base, s.offsetDays) : null;
        if (a.status !== 'preparing' && due && due < today) due = null;
        taskRows.push({ listing_id: c.id, name: s.name, offset_days: s.offsetDays, due_date: due, sort_order: n });
      });
      if (a.row.seller_name || a.row.seller_email) {
        personRows.push({ listing_id: c.id, role: 'Seller', name: a.row.seller_name, email: a.row.seller_email, phone: a.row.seller_phone, position: 0 });
      }
    });
    for (let i = 0; i < taskRows.length; i += 500) await supabaseServer.from('listing_tasks').insert(taskRows.slice(i, i + 500));
    if (personRows.length) await supabaseServer.from('listing_contacts').insert(personRows);

    await logAudit(request, user, 'listing.import', { entityType: 'listing', metadata: { added: created.length, skippedDuplicate, skippedInvalid } });
    return NextResponse.json({ added: created.length, ids: created.map((c) => c.id as string), skippedDuplicate, skippedInvalid });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error importing listings:', error);
    return NextResponse.json({ error: 'Failed to import listings' }, { status: 500 });
  }
}
