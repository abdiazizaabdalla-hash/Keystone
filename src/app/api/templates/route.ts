import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { cleanTemplateInput, requireTemplatesUser, templateError, TEMPLATE_KINDS, type TemplateKind } from '@/lib/templatesServer';
import { templateFitsState, isStateCode } from '@/lib/usStates';
import { agentLabels, assertBrokerageOwner, brokerageOwnersFor } from '@/lib/oversight';

// GET ?state=TX&kind=email&category=post_closing&q=thanks&archived=1
// A template with no states listed is for every state, so ?state=TX returns TX templates and the all-state ones.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request);
    const p = request.nextUrl.searchParams;
    let query = supabaseServer.from('doc_templates').select('*').eq('owner_user_id', user.id).limit(1000);
    if (!(Number(request.nextUrl.searchParams.get('recent')) > 0)) query = query.order('name', { ascending: true });
    if (p.get('archived') !== '1') query = query.eq('archived', false);
    const kind = p.get('kind');
    if (kind) query = query.eq('kind', kind);
    // ?kinds=letter,form: documents; ?kinds=email: emails
    const kinds = (p.get('kinds') || '').split(',').filter((k) => TEMPLATE_KINDS.includes(k as TemplateKind));
    if (kinds.length > 0) query = query.in('kind', kinds);
    // ?recent=5: the ones used most recently, newest first
    const recent = Number(p.get('recent'));
    if (recent > 0) query = query.not('last_used_at', 'is', null).order('last_used_at', { ascending: false }).limit(Math.min(recent, 20));
    const category = p.get('category');
    if (category) query = query.eq('category', category);
    const { data, error } = await query;
    if (error) throw error;
    const state = p.get('state');
    const q = (p.get('q') || '').trim().toLowerCase();
    const rows = (data || [])
      .filter((t) => (state && isStateCode(state) ? templateFitsState(t.states as string[], state) : true))
      .filter((t) => (q ? `${t.name} ${t.description ?? ''} ${t.subject ?? ''}`.toLowerCase().includes(q) : true));

    // Templates the brokerage you belong to shared with you: listed after your own, marked, and never editable here.
    if (!(recent > 0) && p.get('archived') !== '1') {
      const owners = await brokerageOwnersFor(user.id);
      if (owners.length > 0) {
        let sharedQuery = supabaseServer.from('doc_templates').select('*').in('owner_user_id', owners).eq('brokerage_shared', true).eq('archived', false).order('name', { ascending: true }).limit(500);
        if (kind) sharedQuery = sharedQuery.eq('kind', kind);
        if (kinds.length > 0) sharedQuery = sharedQuery.in('kind', kinds);
        if (category) sharedQuery = sharedQuery.eq('category', category);
        const { data: sharedRows } = await sharedQuery;
        const labels = await agentLabels(owners);
        const shared = (sharedRows || [])
          .filter((t) => (state && isStateCode(state) ? templateFitsState(t.states as string[], state) : true))
          .filter((t) => (q ? `${t.name} ${t.description ?? ''} ${t.subject ?? ''}`.toLowerCase().includes(q) : true))
          .map((t) => ({ ...t, from_brokerage: true, shared_by: labels.get(t.owner_user_id as string)?.name ?? 'Your brokerage' }));
        return NextResponse.json([...rows, ...shared]);
      }
    }
    return NextResponse.json(rows);
  } catch (error) {
    return templateError(error, 'load');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.brokerageShared === true) assertBrokerageOwner(user);
    const fields = cleanTemplateInput(body, true);
    const { data, error } = await supabaseServer.from('doc_templates').insert({ ...fields, owner_user_id: user.id }).select('*').single();
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return templateError(error, 'create');
  }
}
