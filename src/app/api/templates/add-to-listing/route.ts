import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { logAudit } from '@/lib/audit';
import { logListingActivity, requireListingAccess } from '@/lib/listings';
import { LISTING_DOC_TYPES } from '@/lib/listingsShared';
import { loadUsableTemplate, markTemplateUsed, requireTemplatesUser, templateError, TEMPLATE_BUCKET } from '@/lib/templatesServer';

const MAX_DOCS = 100;

// POST { listingId, templateIds: string[] }: copies PDF templates from the library into a listing's Documents. Each becomes the
// listing's own file (a separate storage copy), so changing or removing it never touches the template and deleting the template
// leaves it in place. Filed under the template's document type when a listing has that type, else General.
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request);
    const input = (await request.json().catch(() => ({}))) as { listingId?: string; templateIds?: unknown };
    if (!input.listingId) return NextResponse.json({ error: 'Choose a listing' }, { status: 400 });
    const ids = Array.isArray(input.templateIds) ? [...new Set(input.templateIds.filter((x): x is string => typeof x === 'string'))] : [];
    if (ids.length === 0) return NextResponse.json({ error: 'Choose at least one PDF.' }, { status: 400 });
    if (ids.length > 40) return NextResponse.json({ error: 'That is too many at once (40 at most).' }, { status: 400 });
    const listingId = input.listingId;
    await requireListingAccess(request, listingId);
    await assertTrialActive(user);

    const { count } = await supabaseServer.from('listing_documents').select('id', { count: 'exact', head: true }).eq('listing_id', listingId);
    let room = MAX_DOCS - (count ?? 0);

    const added: { templateId: string; name: string; documentId: string | null }[] = [];
    const skipped: { templateId: string; name: string; reason: string }[] = [];
    for (const id of ids) {
      let template;
      try {
        template = await loadUsableTemplate(id, user.id);
      } catch {
        skipped.push({ templateId: id, name: 'A template', reason: 'It is not available to you.' });
        continue;
      }
      const name = template.name as string;
      if (template.kind !== 'form' || !template.storage_path) {
        skipped.push({ templateId: id, name, reason: 'Only PDF templates can be added to a listing.' });
        continue;
      }
      if (room <= 0) {
        skipped.push({ templateId: id, name, reason: `A listing can hold up to ${MAX_DOCS} files.` });
        continue;
      }
      const fileName = (template.file_name as string) || 'Form.pdf';
      const storagePath = `listings/${listingId}/${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      try {
        const { error: copyError } = await supabaseServer.storage.from(TEMPLATE_BUCKET).copy(template.storage_path as string, storagePath);
        if (copyError) throw copyError;
        const documentType = LISTING_DOC_TYPES.includes(template.document_type as string) ? (template.document_type as string) : 'General';
        const { data, error } = await supabaseServer
          .from('listing_documents')
          .insert({ listing_id: listingId, file_name: fileName.slice(0, 300), storage_path: storagePath, content_type: (template.content_type as string) || 'application/pdf', file_size: (template.file_size as number) || 0, document_type: documentType, uploaded_by: user.id })
          .select('id')
          .single();
        if (error) {
          await supabaseServer.storage.from(TEMPLATE_BUCKET).remove([storagePath]);
          throw error;
        }
        room -= 1;
        added.push({ templateId: id, name, documentId: (data?.id as string) ?? null });
        if (!template.from_brokerage) await markTemplateUsed(id, user.id);
      } catch (error) {
        if (error instanceof AuthError) throw error;
        console.error('Could not add a template to a listing:', error);
        skipped.push({ templateId: id, name, reason: 'Something went wrong adding it.' });
      }
    }
    if (added.length > 0) {
      await logListingActivity(listingId, user, `Added from the template library: ${added.map((a) => a.name).join(', ').slice(0, 200)}`);
      await logAudit(request, { id: user.id, email: user.email }, 'listing.templates_added', { entityType: 'listing', entityId: listingId, metadata: { added: added.length, skipped: skipped.length } });
    }
    return NextResponse.json({ added, skipped });
  } catch (error) {
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    return templateError(error, 'use');
  }
}
