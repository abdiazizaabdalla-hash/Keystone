import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { cleanRuleInput, loadOwnTemplate, requireTemplatesUser, templateError } from '@/lib/templatesServer';
import { evaluateTemplateRulesQuietly } from '@/lib/templateRules';

// The automatic rules on one template. A rule drafts the template for a deal when its trigger comes due; the draft
// waits for approval (see /api/template-runs). New rules are on unless { enabled: false } is sent.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { id } = await params;
    await loadOwnTemplate(id, user.id);
    const { data, error } = await supabaseServer.from('template_rules').select('*').eq('template_id', id).eq('owner_user_id', user.id).order('created_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error) {
    return templateError(error, 'load');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireTemplatesUser(request, 'automation');
    const { id } = await params;
    await loadOwnTemplate(id, user.id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const fields = cleanRuleInput(body, true);
    const { count } = await supabaseServer.from('template_rules').select('id', { count: 'exact', head: true }).eq('template_id', id);
    if ((count ?? 0) >= 10) return NextResponse.json({ error: 'A template can have up to 10 rules.' }, { status: 400 });
    const { data, error } = await supabaseServer.from('template_rules').insert({ enabled: true, ...fields, template_id: id, owner_user_id: user.id }).select('*').single();
    if (error) throw error;
    if (data.enabled) await evaluateTemplateRulesQuietly(user.id);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return templateError(error, 'create a rule for');
  }
}
