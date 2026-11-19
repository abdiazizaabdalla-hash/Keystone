import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { loadOwnTemplate, requireTemplatesUser, templateError } from '@/lib/templatesServer';
import { isStateCode } from '@/lib/usStates';
import { findFormSource } from '@/lib/stateFormSources';
import { loadOwnFolder } from '@/lib/templateFolders';

const KINDS = ['folder', 'template', 'trec', 'source', 'custom'] as const;
type PinKind = (typeof KINDS)[number];
const MAX_PINS = 60;

/** A pin is a state folder (a state code), one of your own folders, a template, a TREC form or a state forms source. */
async function checkRef(kind: PinKind, ref: string, ownerId: string) {
  if (kind === 'folder') {
    if (!isStateCode(ref)) throw new AuthError('That is not a folder.', 400);
  } else if (kind === 'template') {
    await loadOwnTemplate(ref, ownerId);
  } else if (kind === 'custom') {
    await loadOwnFolder(ref, ownerId);
  } else if (kind === 'source') {
    if (!findFormSource(ref)) throw new AuthError('That forms source is not in the list.', 404);
  } else {
    const { data } = await supabaseServer.from('trec_forms').select('slug').eq('slug', ref).maybeSingle();
    if (!data) throw new AuthError('That TREC form is not in the list.', 404);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { data, error } = await supabaseServer.from('template_pins').select('kind, ref, created_at').eq('owner_user_id', user.id).order('created_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error) {
    return templateError(error, 'load the pins of');
  }
}

// POST { kind, ref }: pin. Pinning twice is fine.
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request);
    const body = (await request.json().catch(() => ({}))) as { kind?: string; ref?: string };
    if (!KINDS.includes(body.kind as PinKind) || typeof body.ref !== 'string' || !body.ref) throw new AuthError('Choose what to pin.', 400);
    await checkRef(body.kind as PinKind, body.ref, user.id);
    const { count } = await supabaseServer.from('template_pins').select('id', { count: 'exact', head: true }).eq('owner_user_id', user.id);
    if ((count ?? 0) >= MAX_PINS) throw new AuthError(`You can pin up to ${MAX_PINS} things.`, 400);
    const { error } = await supabaseServer.from('template_pins').upsert({ owner_user_id: user.id, kind: body.kind, ref: body.ref }, { onConflict: 'owner_user_id,kind,ref', ignoreDuplicates: true });
    if (error) throw error;
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return templateError(error, 'pin');
  }
}

// DELETE ?kind=&ref=: unpin.
export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request);
    const kind = request.nextUrl.searchParams.get('kind');
    const ref = request.nextUrl.searchParams.get('ref');
    if (!KINDS.includes(kind as PinKind) || !ref) throw new AuthError('Choose what to unpin.', 400);
    const { error } = await supabaseServer.from('template_pins').delete().eq('owner_user_id', user.id).eq('kind', kind!).eq('ref', ref);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return templateError(error, 'unpin');
  }
}
