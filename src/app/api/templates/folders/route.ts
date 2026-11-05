import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { requireTemplatesUser, templateError } from '@/lib/templatesServer';
import { cleanFolderName, isDuplicateName, MAX_FOLDERS } from '@/lib/templateFolders';

// GET: your custom folders with what is in each. POST { name }: make one.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { data: folders, error } = await supabaseServer.from('template_folders').select('id, name, created_at').eq('owner_user_id', user.id).order('created_at', { ascending: true });
    if (error) throw error;
    const ids = (folders ?? []).map((f) => f.id);
    const items = ids.length
      ? ((await supabaseServer.from('template_folder_items').select('folder_id, kind, ref, created_at').in('folder_id', ids).order('created_at', { ascending: true })).data ?? [])
      : [];
    return NextResponse.json((folders ?? []).map((f) => ({ ...f, items: items.filter((i) => i.folder_id === f.id).map((i) => ({ kind: i.kind, ref: i.ref })) })));
  } catch (error) {
    return templateError(error, 'load the folders of');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request, 'custom_templates');
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = cleanFolderName(body.name);
    const { count } = await supabaseServer.from('template_folders').select('id', { count: 'exact', head: true }).eq('owner_user_id', user.id);
    if ((count ?? 0) >= MAX_FOLDERS) throw new AuthError(`You can have up to ${MAX_FOLDERS} folders.`, 400);
    const { data, error } = await supabaseServer.from('template_folders').insert({ owner_user_id: user.id, name }).select('id, name, created_at').single();
    if (isDuplicateName(error)) throw new AuthError('You already have a folder with that name.', 409);
    if (error) throw error;
    return NextResponse.json({ ...data, items: [] }, { status: 201 });
  } catch (error) {
    return templateError(error, 'create a folder for');
  }
}
