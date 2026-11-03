import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { cleanTemplateInput, loadOwnTemplate, requireTemplatesUser, templateError, TEMPLATE_BUCKET } from '@/lib/templatesServer';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { id } = await params;
    return NextResponse.json(await loadOwnTemplate(id, user.id));
  } catch (error) {
    return templateError(error, 'load');
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { id } = await params;
    await loadOwnTemplate(id, user.id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const fields = cleanTemplateInput(body, false);
    const { data, error } = await supabaseServer
      .from('doc_templates')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    return templateError(error, 'update');
  }
}

// DELETE: removes the template, its uploaded file and its rules. What it already generated stays in the approvals history.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { id } = await params;
    const template = await loadOwnTemplate(id, user.id);
    if (template.storage_path) await supabaseServer.storage.from(TEMPLATE_BUCKET).remove([template.storage_path as string]);
    const { error } = await supabaseServer.from('doc_templates').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ status: 'deleted' });
  } catch (error) {
    return templateError(error, 'delete');
  }
}
