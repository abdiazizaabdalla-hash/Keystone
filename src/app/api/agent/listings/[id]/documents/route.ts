import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { requireAgentListing } from '@/lib/agentListings';
import { checkRateLimit } from '@/lib/rateLimit';
import { logListingActivity } from '@/lib/listings';
import { LISTING_DOC_TYPES } from '@/lib/listingsShared';
import { LISTING_FILE_TYPES } from '@/lib/incomingUploads';

const BUCKET = 'transaction-documents';
// Sent straight through the app (the agent portal has no direct-to-storage upload), so it has to fit
// inside the platform's request size limit.
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_DOCS = 100;

// POST (multipart: file, documentType): the agent adds a document to a listing that is shared with them.
// Same file-type allowlist as the coordinator's Documents. Moving and deleting stay with the coordinator.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireAgentListing(request, id);
    if (!(await checkRateLimit(`agent-listing-doc:${user.id}`, 40, 60 * 60))) {
      return NextResponse.json({ error: 'You have uploaded a lot of files. Try again a bit later.' }, { status: 429 });
    }
    if (!(request.headers.get('content-type') || '').toLowerCase().includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Send the file as a form upload' }, { status: 400 });
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (file.size <= 0) return NextResponse.json({ error: 'That file is empty' }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Files here can be up to 4 MB. Send larger ones to your coordinator.' }, { status: 400 });
    const ext = file.name.toLowerCase().split('.').pop() || '';
    const contentType = LISTING_FILE_TYPES[ext];
    if (!contentType) return NextResponse.json({ error: 'That file type is not allowed. Use PDF, Word, Excel, text or an image.' }, { status: 400 });
    const typeRaw = form.get('documentType');
    const documentType = typeof typeRaw === 'string' && LISTING_DOC_TYPES.includes(typeRaw) ? typeRaw : 'General';

    const { count } = await supabaseServer.from('listing_documents').select('id', { count: 'exact', head: true }).eq('listing_id', id);
    if ((count ?? 0) >= MAX_DOCS) return NextResponse.json({ error: `A listing can hold up to ${MAX_DOCS} files` }, { status: 400 });

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `listings/${id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabaseServer.storage.from(BUCKET).upload(storagePath, await file.arrayBuffer(), { contentType, upsert: false });
    if (uploadError) throw uploadError;

    const { data, error } = await supabaseServer
      .from('listing_documents')
      .insert({ listing_id: id, file_name: file.name.slice(0, 300), storage_path: storagePath, content_type: contentType, file_size: file.size, document_type: documentType, uploaded_by: user.id })
      .select('id, file_name, document_type, content_type, file_size, is_signed, created_at')
      .single();
    if (error || !data) {
      await supabaseServer.storage.from(BUCKET).remove([storagePath]); // don't leave an orphaned file behind
      throw error || new Error('insert failed');
    }
    const label = (user.user_metadata?.full_name as string | undefined)?.trim() || user.email || 'The agent';
    await logListingActivity(id, user, `${label} uploaded ${file.name.slice(0, 120)} (${documentType})`);
    return NextResponse.json(
      { id: data.id, fileName: data.file_name, documentType: data.document_type, contentType: data.content_type, fileSize: data.file_size, isSigned: data.is_signed === true, createdAt: data.created_at },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error uploading a listing document as the agent:', error);
    return NextResponse.json({ error: 'Failed to upload' }, { status: 500 });
  }
}
