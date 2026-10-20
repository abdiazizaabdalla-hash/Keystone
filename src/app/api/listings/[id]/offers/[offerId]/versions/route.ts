import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { logListingActivity, requireListingAccess } from '@/lib/listings';
import { cleanChild } from '@/lib/listingChildren';
import { MAX_OFFER_FILES, MAX_OFFER_FILE_SIZE, OFFER_BUCKET, OFFER_FILE_TYPES, cleanDocKind, offerFileType, storeOfferFiles } from '@/lib/listingOfferFiles';
import { IncomingError, parseUploadRequest, removeIncoming } from '@/lib/incomingUploads';
import { VERSION_KINDS, VERSION_KIND_LABEL, diffTerms, normalizeTerms, rowToTerms, termsToBody, type VersionKind } from '@/lib/offerTerms';

export const maxDuration = 60;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// GET: every version of one offer, oldest first, each with the documents that came with it.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; offerId: string }> }) {
  try {
    const { id, offerId } = await params;
    await requireListingAccess(request, id);
    const [{ data: versions, error }, { data: docs }] = await Promise.all([
      supabaseServer.from('listing_offer_versions').select('*').eq('offer_id', offerId).eq('listing_id', id).order('version_number', { ascending: true }),
      supabaseServer.from('listing_offer_documents').select('*').eq('offer_id', offerId).eq('listing_id', id).order('created_at', { ascending: true }),
    ]);
    if (error) throw error;
    const withUrls = await Promise.all(
      (docs || []).map(async (d) => {
        const { data: signed } = await supabaseServer.storage.from(OFFER_BUCKET).createSignedUrl(d.storage_path as string, SIGNED_URL_TTL_SECONDS);
        return { ...d, url: signed?.signedUrl || null };
      })
    );
    return NextResponse.json({ versions: versions || [], documents: withUrls });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error loading offer versions:', error);
    return NextResponse.json({ error: 'Failed to load the offer history' }, { status: 500 });
  }
}

// POST: record a counteroffer, amendment or revised offer. The offer's current terms become the new version's
// terms and the old version stays in the history. multipart: `files` + `payload` (terms, kind, label, summary, docKinds).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; offerId: string }> }) {
  let versionId: string | null = null;
  try {
    const { id, offerId } = await params;
    const { user, listing } = await requireListingAccess(request, id);
    await assertTrialActive(user);

    const { data: offer } = await supabaseServer.from('listing_offers').select('*').eq('id', offerId).eq('listing_id', id).maybeSingle();
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 });

    // JSON { uploads: [{ path, name }], payload } (files already in private storage) or small multipart.
    const parsed = await parseUploadRequest(request, user.id, OFFER_FILE_TYPES, MAX_OFFER_FILES);
    const files = parsed.files;
    if (files.length > MAX_OFFER_FILES) return NextResponse.json({ error: `Attach up to ${MAX_OFFER_FILES} files` }, { status: 400 });
    for (const f of files) {
      if (!offerFileType(f.name)) return NextResponse.json({ error: `${f.name}: use PDF, Word or an image` }, { status: 400 });
      if (f.size > MAX_OFFER_FILE_SIZE) return NextResponse.json({ error: `${f.name} is over the 25MB limit` }, { status: 400 });
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(parsed.field('payload') || '{}'));
    } catch {
      return NextResponse.json({ error: 'Could not read the details' }, { status: 400 });
    }
    const kind = (VERSION_KINDS.includes(payload.kind as VersionKind) && payload.kind !== 'original' ? payload.kind : 'amendment') as VersionKind;
    const newTerms = normalizeTerms(payload.terms as Record<string, unknown>);
    const previous = rowToTerms(offer);
    const changes = diffTerms(previous, newTerms);

    const cleaned = cleanChild('offers', { ...termsToBody(newTerms), receivedOn: offer.received_on }, listing as { planned_list_date: string | null }, false);
    if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

    const nextNumber = Number(offer.current_version || 1) + 1;
    const actor = (user.user_metadata?.full_name as string | undefined)?.trim() || user.email || null;
    const label = (typeof payload.label === 'string' && payload.label.trim().slice(0, 120)) || `${VERSION_KIND_LABEL[kind]} ${nextNumber - 1}`;
    const summary =
      (typeof payload.summary === 'string' && payload.summary.trim().slice(0, 1000)) ||
      (changes.length ? changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join('; ').slice(0, 1000) : null);

    const { data: version, error: vErr } = await supabaseServer
      .from('listing_offer_versions')
      .insert({ offer_id: offerId, listing_id: id, version_number: nextNumber, kind, label, terms: newTerms, summary, created_by_label: actor })
      .select('id')
      .single();
    if (vErr) throw vErr;
    versionId = version.id as string;

    const rawKinds = Array.isArray(payload.docKinds) ? payload.docKinds : [];
    const kinds = files.map((_, i) => cleanDocKind(rawKinds[i] ?? (kind === 'counteroffer' ? 'counteroffer' : 'addendum')));
    if (files.length) await storeOfferFiles({ listingId: id, offerId, files, kinds, versionIds: files.map(() => versionId), receivedAt: new Date().toISOString() });

    // The offer row now reflects the latest terms. Keep who/when it was received.
    const { received_on: _keep, ...termColumns } = cleaned.value as Record<string, unknown>;
    void _keep;
    const update: Record<string, unknown> = { ...termColumns, current_version: nextNumber };
    if (kind === 'counteroffer' && offer.status === 'received') update.status = 'countered';
    const { data: updated, error: uErr } = await supabaseServer.from('listing_offers').update(update).eq('id', offerId).select('*').single();
    if (uErr) throw uErr;

    await removeIncoming(parsed.incomingPaths);
    await logListingActivity(id, user, `${VERSION_KIND_LABEL[kind]} recorded for offer${offer.buyer_name ? ` from ${offer.buyer_name}` : ''}${changes.length ? ` (${changes.length} term${changes.length === 1 ? '' : 's'} changed)` : ''}`);
    return NextResponse.json({ offer: updated, changes });
  } catch (error) {
    // The version row (and its documents) go away if the offer itself could not be updated.
    if (versionId) {
      const { data: orphaned } = await supabaseServer.from('listing_offer_documents').select('storage_path').eq('version_id', versionId);
      const paths = (orphaned || []).map((d) => d.storage_path as string);
      if (paths.length) await supabaseServer.storage.from(OFFER_BUCKET).remove(paths);
      await supabaseServer.from('listing_offer_documents').delete().eq('version_id', versionId);
      await supabaseServer.from('listing_offer_versions').delete().eq('id', versionId);
    }
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof IncomingError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error recording offer version:', error);
    return NextResponse.json({ error: 'Failed to save this change' }, { status: 500 });
  }
}
