import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { requireListingAccess } from '@/lib/listings';
import type { InboundAttachment } from '@/lib/listingInbound';

// GET: offer emails held for review on this listing (newest first). Names and sizes only; the files are
// opened through the "stage" step when the coordinator chooses to review one.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireListingAccess(request, id);
    const { data, error } = await supabaseServer
      .from('listing_inbound_offers')
      .select('id, from_email, from_name, subject, snippet, attachments, received_at')
      .eq('listing_id', id)
      .eq('status', 'pending')
      .order('received_at', { ascending: false })
      .limit(50);
    if (error) return NextResponse.json({ items: [], available: false }); // add-listing-round3.sql not run yet
    const items = (data || []).map((r) => ({
      id: r.id,
      fromEmail: r.from_email,
      fromName: r.from_name,
      subject: r.subject,
      snippet: r.snippet,
      receivedAt: r.received_at,
      files: ((r.attachments as InboundAttachment[]) || []).map((a) => ({ name: a.name, size: a.size })),
    }));
    return NextResponse.json({ items, available: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error loading inbound offers:', error);
    return NextResponse.json({ error: 'Failed to load emails' }, { status: 500 });
  }
}
