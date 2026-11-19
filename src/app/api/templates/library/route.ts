import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertBrokerageOwner } from '@/lib/oversight';
import { isStateCode } from '@/lib/usStates';
import { isValidCategory, resolveDocumentPlacement } from '@/lib/documentTaxonomy';
import { requireTemplatesUser, templateError, TEMPLATE_BUCKET } from '@/lib/templatesServer';

const MAX_BYTES = 15 * 1024 * 1024;

// POST (multipart): puts ONE PDF in the template library. The screen sends several PDFs as several calls, so one bad file never
// blocks the rest. Fields: file, name, scope, state, documentCategory, documentType, share.
//   scope "state"     a state-specific contract or form: state is required and the PDF is filed in that state's folder.
//   scope "brokerage" a brokerage template for every state, shared with the brokerage's agents (brokerage owners only).
//   scope "general"   a general transaction document for every state, kept for the uploader.
// Only PDFs are accepted here. A template is private to the uploader unless a brokerage owner shares it.
export async function POST(request: NextRequest) {
  let path: string | null = null;
  try {
    const { user } = await requireTemplatesUser(request, 'custom_templates');
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AuthError('Choose a PDF to upload.', 400);
    if (file.size === 0) throw new AuthError('That file is empty.', 400);
    if (file.size > MAX_BYTES) throw new AuthError('That file is over 15 MB.', 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
    if (!isPdf) throw new AuthError('Only PDF files can go in the template library.', 400);

    const scope = String(form.get('scope') ?? '');
    if (!['state', 'brokerage', 'general'].includes(scope)) throw new AuthError('Say whether this is a state-specific document.', 400);
    const state = String(form.get('state') ?? '').toUpperCase();
    if (scope === 'state' && !isStateCode(state)) throw new AuthError('Choose the state this document is for.', 400);
    const rawCategory = String(form.get('documentCategory') ?? '');
    if (rawCategory && !isValidCategory(rawCategory)) throw new AuthError('Choose a document category from the list.', 400);
    if (scope !== 'brokerage' && !rawCategory) throw new AuthError('Choose a category for this document.', 400);
    const placement = resolveDocumentPlacement(rawCategory || null, String(form.get('documentType') ?? ''));

    const share = scope === 'brokerage' || String(form.get('share') ?? '') === 'true';
    if (share) await assertBrokerageOwner(user);

    const baseName = file.name.replace(/\.pdf$/i, '');
    const name = String(form.get('name') ?? '').trim().slice(0, 140) || baseName.slice(0, 140) || 'Untitled PDF';
    const safeName = file.name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) || 'form.pdf';
    path = `templates/${user.id}/${randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabaseServer.storage.from(TEMPLATE_BUCKET).upload(path, bytes, { contentType: 'application/pdf' });
    if (uploadError) throw uploadError;

    const { data, error } = await supabaseServer
      .from('doc_templates')
      .insert({
        owner_user_id: user.id,
        kind: 'form',
        name,
        category: 'general',
        states: scope === 'state' ? [state] : [],
        document_category: placement.category,
        document_type: placement.documentType,
        file_name: safeName,
        storage_path: path,
        content_type: 'application/pdf',
        file_size: file.size,
        brokerage_shared: share,
      })
      .select('*')
      .single();
    if (error) {
      await supabaseServer.storage.from(TEMPLATE_BUCKET).remove([path]);
      throw error;
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return templateError(error, 'upload');
  }
}
