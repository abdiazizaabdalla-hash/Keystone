import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { logListingActivity, requireListingAccess } from '@/lib/listings';
import { MAX_PER_LISTING, cleanChild } from '@/lib/listingChildren';
import { MAX_OFFER_FILES, MAX_OFFER_FILE_SIZE, OFFER_BUCKET, cleanDocKind, offerDocPaths, offerFileType, storeOfferFiles } from '@/lib/listingOfferFiles';
import { normalizeTerms, termsToBody } from '@/lib/offerTerms';

export const maxDuration = 60;

// Saves a new offer the TC has reviewed: the offer row, its version history, and the original documents.
// multipart: `files` (the documents) + `payload` (JSON: terms, optional originalTerms, receivedOn, docKinds, summary).
// When `originalTerms` is sent, the offer starts with two versions: the contract as first written (v1) and the
// terms after its addenda (v2). Contract documents attach to v1, addenda and counteroffers to v2.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let offerId: string | null = null;
  try {
    const { id } = await params;
    const { user, listing } = await requireListingAccess(request, id);
    await assertTrialActive(user);

    const form = await request.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length > MAX_OFFER_FILES) return NextResponse.json({ error: `Attach up to ${MAX_OFFER_FILES} files` }, { status: 400 });
    for (const f of files) {
      if (!offerFileType(f.name)) return NextResponse.json({ error: `${f.name}: use PDF, Word or an image` }, { status: 400 });
      if (f.size > MAX_OFFER_FILE_SIZE) return NextResponse.json({ error: `${f.name} is over the 25MB limit` }, { status: 400 });
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(form.get('payload') || '{}'));
    } catch {
      return NextResponse.json({ error: 'Could not read the offer details' }, { status: 400 });
    }

    const finalTerms = normalizeTerms(payload.terms as Record<string, unknown>);
    const originalTerms = payload.originalTerms ? normalizeTerms(payload.originalTerms as Record<string, unknown>) : null;
    const receivedOn = typeof payload.receivedOn === 'string' ? payload.receivedOn : '';

    const cleaned = cleanChild('offers', { ...termsToBody(finalTerms), receivedOn }, listing as { planned_list_date: string | null }, false);
    if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

    const { count } = await supabaseServer.from('listing_offers').select('id', { count: 'exact', head: true }).eq('listing_id', id);
    if ((count ?? 0) >= MAX_PER_LISTING) return NextResponse.json({ error: `A listing can hold up to ${MAX_PER_LISTING} offers` }, { status: 400 });

    const twoVersions = Boolean(originalTerms);
    const { data: offer, error } = await supabaseServer
      .from('listing_offers')
      .insert({ ...cleaned.value, listing_id: id, current_version: twoVersions ? 2 : 1 })
      .select('*')
      .single();
    if (error) throw error;
    offerId = offer.id as string;

    const actor = (user.user_metadata?.full_name as string | undefined)?.trim() || user.email || null;
    const summary = typeof payload.summary === 'string' ? payload.summary.slice(0, 1000) : null;
    const versionRows = twoVersions
      ? [
          { version_number: 1, kind: 'original', label: 'Offer as first written', terms: originalTerms },
          { version_number: 2, kind: 'amendment', label: 'After addenda', terms: finalTerms, summary },
        ]
      : [{ version_number: 1, kind: 'original', label: 'Original offer', terms: finalTerms }];
    const { data: versions, error: vErr } = await supabaseServer
      .from('listing_offer_versions')
      .insert(versionRows.map((v) => ({ ...v, offer_id: offerId, listing_id: id, created_by_label: actor })))
      .select('id, version_number');
    if (vErr) throw vErr;
    const idOf = (n: number) => (versions || []).find((v) => v.version_number === n)?.id as string | undefined;

    const rawKinds = Array.isArray(payload.docKinds) ? payload.docKinds : [];
    const kinds = files.map((_, i) => cleanDocKind(rawKinds[i]));
    // Contract -> first version; addenda and counteroffers -> the later version when there are two.
    const versionIds = kinds.map((k) => (twoVersions && k !== 'purchase_contract' ? idOf(2) : idOf(1)) ?? null);
    if (files.length) await storeOfferFiles({ listingId: id, offerId, files, kinds, versionIds, receivedAt: new Date().toISOString() });

    const price = cleaned.value.offer_price ? ` for $${Number(cleaned.value.offer_price).toLocaleString('en-US')}` : '';
    await logListingActivity(id, user, `Offer received${cleaned.value.buyer_name ? ` from ${cleaned.value.buyer_name}` : ''}${price}${files.length ? ` (${files.length} document${files.length === 1 ? '' : 's'} attached)` : ''}`);
    return NextResponse.json(offer, { status: 201 });
  } catch (error) {
    // Nothing half-saved: if the offer row was created before something failed, remove it (children cascade).
    if (offerId) {
      const paths = await offerDocPaths({ offerId });
      if (paths.length) await supabaseServer.storage.from(OFFER_BUCKET).remove(paths);
      await supabaseServer.from('listing_offers').delete().eq('id', offerId);
    }
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error saving offer from documents:', error);
    return NextResponse.json({ error: 'Failed to save the offer' }, { status: 500 });
  }
}
