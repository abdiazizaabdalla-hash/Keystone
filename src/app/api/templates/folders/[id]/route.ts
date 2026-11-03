import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { requireTemplatesUser, templateError } from '@/lib/templatesServer';
import { cleanFolderName, isDuplicateName, loadOwnFolder } from '@/lib/templateFolders';

type Ctx = { params: Promise<{ id: string }> };

// PATCH { name }: rename.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { id } = await params;
    await loadOwnFolder(id, user.id);
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = cleanFolderName(body.name);
    const { error } = await supabaseServer.from('template_folders').update({ name }).eq('id', id).eq('owner_user_id', user.id);
    if (isDuplicateName(error)) throw new AuthError('You already have a folder with that name.', 409);
    if (error) throw error;
    return NextResponse.json({ ok: true, name });
  } catch (error) {
    return templateError(error, 'rename a folder of');
  }
}

// DELETE: remove the folder. The documents in it are not touched, only the shortcuts.
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { id } = await params;
    await loadOwnFolder(id, user.id);
    await supabaseServer.from('template_pins').delete().eq('owner_user_id', user.id).eq('kind', 'custom').eq('ref', id);
    const { error } = await supabaseServer.from('template_folders').delete().eq('id', id).eq('owner_user_id', user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return templateError(error, 'delete a folder of');
  }
}
