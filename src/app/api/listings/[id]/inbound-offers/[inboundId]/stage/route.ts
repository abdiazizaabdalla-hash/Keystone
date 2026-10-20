import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { checkRateLimit } from '@/lib/rateLimit';
import { requireListingAccess } from '@/lib/listings';
import { INCOMING_BUCKET, INCOMING_ROOT, safeFileName } from '@/lib/incomingUploads';
import { isInboundPath, isUuid, type InboundAttachment } from '@/lib/listingInbound';

// POST: copy a held email's files into the caller's own incoming folder so the normal "add an offer from its
// documents" window can read and save them. The held copy stays until the offer is saved or the email dismissed.
// Returns the copies with short-lived links so the browser can show them next to the terms.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; inboundId: string }> }) {
  try {
    const { id, inboundId } = await params;
    const { user } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    if (!isUuid(inboundId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!(await checkRateLimit(`inbound-stage:${user.id}`, 60, 60 * 60))) {
      return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
    }
    const { data: row } = await supabaseServer.from('listing_inbound_offers').select('id, attachments, status').eq('id', inboundId).eq('listing_id', id).eq('status', 'pending').maybeSingle();
    if (!row) return NextResponse.json({ error: 'That email is no longer waiting' }, { status: 404 });

    const files: { name: string; path: string; url: string | null }[] = [];
    for (const a of ((row.attachments as InboundAttachment[]) || []).slice(0, 8)) {
      if (!isInboundPath(id, a.path)) continue; // only files this feature stored for this listing
      const dest = `${INCOMING_ROOT}/${user.id}/${crypto.randomUUID()}-${safeFileName(a.name)}`;
      const { error } = await supabaseServer.storage.from(INCOMING_BUCKET).copy(a.path, dest);
      if (error) continue;
      const { data: signed } = await supabaseServer.storage.from(INCOMING_BUCKET).createSignedUrl(dest, 15 * 60);
      files.push({ name: a.name, path: dest, url: signed?.signedUrl ?? null });
    }
    if (files.length === 0) return NextResponse.json({ error: 'Those files could not be opened' }, { status: 410 });
    return NextResponse.json({ files });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error staging inbound offer:', error);
    return NextResponse.json({ error: 'Failed to open the email' }, { status: 500 });
  }
}
