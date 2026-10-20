import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { requireAgentListing } from '@/lib/agentListings';

const BUCKET = 'transaction-documents';
const URL_TTL_SECONDS = 5 * 60;

// GET: a short-lived link to open one document on a listing that is shared with this agent. The link is made at
// click time (not stored on the page), and only for a file that belongs to this listing.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  try {
    const { id, docId } = await params;
    await requireAgentListing(request, id);
    const { data: doc } = await supabaseServer.from('listing_documents').select('file_name, storage_path').eq('id', docId).eq('listing_id', id).maybeSingle();
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    const { data: signed } = await supabaseServer.storage.from(BUCKET).createSignedUrl(doc.storage_path as string, URL_TTL_SECONDS);
    if (!signed?.signedUrl) return NextResponse.json({ error: 'Could not open that file' }, { status: 500 });
    return NextResponse.json({ url: signed.signedUrl, fileName: doc.file_name });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error opening agent listing document:', error);
    return NextResponse.json({ error: 'Failed to open the document' }, { status: 500 });
  }
}
