import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { requireTemplatesUser, templateError } from '@/lib/templatesServer';
import { checkFolderItem, FOLDER_ITEM_KINDS, loadOwnFolder, MAX_ITEMS_PER_FOLDER, type FolderItemKind } from '@/lib/templateFolders';

type Ctx = { params: Promise<{ id: string }> };

// POST { kind, ref }: put a document, TREC form or state forms source in the folder. Adding twice is fine.
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { user } = await requireTemplatesUser(request, 'custom_templates');
    const { id } = await params;
    await loadOwnFolder(id, user.id);
    const body = (await request.json().catch(() => ({}))) as { kind?: string; ref?: string };
    if (!FOLDER_ITEM_KINDS.includes(body.kind as FolderItemKind) || typeof body.ref !== 'string' || !body.ref) throw new AuthError('Choose what to add.', 400);
    await checkFolderItem(body.kind as FolderItemKind, body.ref, user.id);
    const { count } = await supabaseServer.from('template_folder_items').select('id', { count: 'exact', head: true }).eq('folder_id', id);
    if ((count ?? 0) >= MAX_ITEMS_PER_FOLDER) throw new AuthError(`A folder holds up to ${MAX_ITEMS_PER_FOLDER} things.`, 400);
    const { error } = await supabaseServer.from('template_folder_items').upsert({ folder_id: id, owner_user_id: user.id, kind: body.kind, ref: body.ref }, { onConflict: 'folder_id,kind,ref', ignoreDuplicates: true });
    if (error) throw error;
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return templateError(error, 'add to a folder of');
  }
}

// DELETE ?kind=&ref=: take it out of the folder.
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { user } = await requireTemplatesUser(request, 'custom_templates');
    const { id } = await params;
    await loadOwnFolder(id, user.id);
    const kind = request.nextUrl.searchParams.get('kind');
    const ref = request.nextUrl.searchParams.get('ref');
    if (!FOLDER_ITEM_KINDS.includes(kind as FolderItemKind) || !ref) throw new AuthError('Choose what to remove.', 400);
    const { error } = await supabaseServer.from('template_folder_items').delete().eq('folder_id', id).eq('kind', kind!).eq('ref', ref);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return templateError(error, 'remove from a folder of');
  }
}
