import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { requireListingAccess } from '@/lib/listings';
import { LISTING_DOC_TYPES } from '@/lib/listingsShared';

const BUCKET = 'transaction-documents';
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_DOCS = 100;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// Same allowlist as transaction documents: no scripts, HTML/SVG or archives. Content type comes from the extension.
const ALLOWED: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  rtf: 'application/rtf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} listing documents:`, error);
  return NextResponse.json({ error: `Failed to ${what}` }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireListingAccess(request, id);
    const { data, error } = await supabaseServer.from('listing_documents').select('*').eq('listing_id', id).order('created_at', { ascending: false });
    if (error) throw error;
    const withUrls = await Promise.all(
      (data || []).map(async (d) => {
        const { data: signed } = await supabaseServer.storage.from(BUCKET).createSignedUrl(d.storage_path as string, SIGNED_URL_TTL_SECONDS);
        return { ...d, url: signed?.signedUrl || null };
      })
    );
    return NextResponse.json(withUrls);
  } catch (error) {
    return fail(error, 'load');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireListingAccess(request, id);
    await assertTrialActive(user);

    const form = await request.formData();
    const file = form.get('file');
    const typeRaw = form.get('documentType');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'File exceeds the 25MB limit' }, { status: 400 });
    const ext = file.name.toLowerCase().split('.').pop() || '';
    const contentType = ALLOWED[ext];
    if (!contentType) return NextResponse.json({ error: 'That file type is not allowed. Use PDF, Word, Excel, text or an image.' }, { status: 400 });
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
      .select('*')
      .single();
    if (error) {
      await supabaseServer.storage.from(BUCKET).remove([storagePath]); // don't leave an orphaned file behind
      throw error;
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return fail(error, 'upload');
  }
}
