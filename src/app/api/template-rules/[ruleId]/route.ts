import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { cleanRuleInput, loadOwnRule, requireTemplatesUser, templateError } from '@/lib/templatesServer';
import { evaluateTemplateRulesQuietly } from '@/lib/templateRules';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const { user } = await requireTemplatesUser(request, 'automation');
    const { ruleId } = await params;
    await loadOwnRule(ruleId, user.id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const fields = cleanRuleInput(body, false);
    const { data, error } = await supabaseServer.from('template_rules').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', ruleId).select('*').single();
    if (error) throw error;
    if (data.enabled) await evaluateTemplateRulesQuietly(user.id);
    return NextResponse.json(data);
  } catch (error) {
    return templateError(error, 'update the rule on');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const { user } = await requireTemplatesUser(request, 'automation');
    const { ruleId } = await params;
    await loadOwnRule(ruleId, user.id);
    // Drafts already waiting are cleared with the rule; ones already sent or dismissed stay as the record.
    await supabaseServer.from('template_runs').delete().eq('rule_id', ruleId).eq('status', 'pending');
    const { error } = await supabaseServer.from('template_rules').delete().eq('id', ruleId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return templateError(error, 'delete the rule on');
  }
}
