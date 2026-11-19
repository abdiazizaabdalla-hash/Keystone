import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { loadOwnTemplate, loadUsableTemplate, requireTemplatesUser, templateError, TEMPLATE_BUCKET } from '@/lib/templatesServer';

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

// POST (multipart, field "file"): attach your own form to a "form" template. GET: a short-lived link to open it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireTemplatesUser(request, 'custom_templates');
    const { id } = await params;
    const template = await loadOwnTemplate(id, user.id);
    if (template.kind !== 'form') throw new AuthError('Only a form template carries a file.', 400);

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AuthError('Choose a file to upload.', 400);
    if (file.size > MAX_BYTES) throw new AuthError('That file is over 15 MB.', 400);
    if (!ALLOWED[file.type]) throw new AuthError('Upload a PDF or Word file.', 400);

    const safeName = file.name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) || `form.${ALLOWED[file.type]}`;
    const path = `templates/${user.id}/${randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabaseServer.storage.from(TEMPLATE_BUCKET).upload(path, await file.arrayBuffer(), { contentType: file.type });
    if (uploadError) throw uploadError;

    if (template.storage_path) await supabaseServer.storage.from(TEMPLATE_BUCKET).remove([template.storage_path as string]);
    const { data, error } = await supabaseServer
      .from('doc_templates')
      .update({ file_name: safeName, storage_path: path, content_type: file.type, file_size: file.size, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      await supabaseServer.storage.from(TEMPLATE_BUCKET).remove([path]);
      throw error;
    }
    return NextResponse.json(data);
  } catch (error) {
    return templateError(error, 'upload');
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { id } = await params;
    const template = await loadUsableTemplate(id, user.id);
    if (!template.storage_path) throw new AuthError('This template has no file yet.', 404);
    const { data } = await supabaseServer.storage.from(TEMPLATE_BUCKET).createSignedUrl(template.storage_path as string, 3600);
    return NextResponse.json({ url: data?.signedUrl ?? null, fileName: template.file_name });
  } catch (error) {
    return templateError(error, 'open');
  }
}
