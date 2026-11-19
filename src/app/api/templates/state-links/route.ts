import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { isStateCode } from '@/lib/usStates';
import { requireTemplatesUser, templateError } from '@/lib/templatesServer';

const MAX_LINKS = 200;

// A person's own links to a state's forms pages, shown under State Resources. A link is only ever opened; it is never a PDF template
// and never attached to a deal. GET ?state=TX (optional): the caller's links. POST { state, label, url }. DELETE ?id=.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request);
    const state = request.nextUrl.searchParams.get('state');
    let q = supabaseServer.from('template_state_links').select('*').eq('owner_user_id', user.id).order('created_at', { ascending: true }).limit(MAX_LINKS);
    if (state) q = q.eq('state', state.toUpperCase());
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error) {
    return templateError(error, 'load');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request, 'custom_templates');
    const body = (await request.json().catch(() => ({}))) as { state?: unknown; label?: unknown; url?: unknown };
    const state = typeof body.state === 'string' ? body.state.toUpperCase() : '';
    if (!isStateCode(state)) throw new AuthError('Choose a state.', 400);
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    let parsed: URL;
    try {
      parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
    } catch {
      throw new AuthError('That does not look like a web address.', 400);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new AuthError('Use a web address that starts with https://', 400);
    const label = (typeof body.label === 'string' ? body.label.trim() : '').slice(0, 140) || parsed.hostname;
    const { count } = await supabaseServer.from('template_state_links').select('id', { count: 'exact', head: true }).eq('owner_user_id', user.id);
    if ((count ?? 0) >= MAX_LINKS) throw new AuthError('You have reached the limit of saved links.', 400);
    const { data, error } = await supabaseServer.from('template_state_links').insert({ owner_user_id: user.id, state, label, url: parsed.toString().slice(0, 500) }).select('*').single();
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return templateError(error, 'save');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request, 'custom_templates');
    const id = request.nextUrl.searchParams.get('id');
    if (!id) throw new AuthError('Choose a link to remove.', 400);
    const { error } = await supabaseServer.from('template_state_links').delete().eq('id', id).eq('owner_user_id', user.id);
    if (error) throw error;
    return NextResponse.json({ status: 'deleted' });
  } catch (error) {
    return templateError(error, 'delete');
  }
}
