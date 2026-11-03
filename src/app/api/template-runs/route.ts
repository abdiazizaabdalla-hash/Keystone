import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { requireTemplatesUser, templateError } from '@/lib/templatesServer';
import { evaluateTemplateRulesQuietly } from '@/lib/templateRules';
import { outboxOnly } from '@/lib/dealEmail';

// GET ?status=pending|sent|dismissed|failed|all (default pending): the drafts automatic rules have made, with the
// deal each one is for. Checking the list also makes any draft that has come due, so it is never out of date.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request);
    const status = request.nextUrl.searchParams.get('status') || 'pending';
    if (status === 'pending') await evaluateTemplateRulesQuietly(user.id);
    let query = supabaseServer.from('template_runs').select('*').eq('owner_user_id', user.id).order('due_on', { ascending: false }).order('created_at', { ascending: false }).limit(200);
    if (status !== 'all') query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    const runs = data || [];
    const ids = [...new Set(runs.map((r) => r.transaction_id as string))];
    const names = new Map<string, { file_number: string; property_address: string }>();
    if (ids.length > 0) {
      const { data: tx } = await supabaseServer.from('transactions').select('id, file_number, property_address').in('id', ids);
      for (const t of tx || []) names.set(t.id as string, { file_number: t.file_number as string, property_address: t.property_address as string });
    }
    const templateIds = [...new Set(runs.map((r) => r.template_id as string | null).filter((x): x is string => !!x))];
    const templateNames = new Map<string, string>();
    if (templateIds.length > 0) {
      const { data: ts } = await supabaseServer.from('doc_templates').select('id, name').in('id', templateIds);
      for (const t of ts || []) templateNames.set(t.id as string, t.name as string);
    }
    const { data: ruleRows } = await supabaseServer.from('template_rules').select('id, enabled, trigger_event, offset_days, repeat_yearly, repeat_years, recipient_roles').eq('owner_user_id', user.id);
    const ruleById = new Map((ruleRows || []).map((r) => [r.id as string, r]));
    return NextResponse.json({
      outboxOnly: outboxOnly(),
      rules: { total: (ruleRows || []).length, enabled: (ruleRows || []).filter((r) => r.enabled).length },
      runs: runs.map((r) => ({ ...r, deal: names.get(r.transaction_id as string) ?? null, template_name: r.template_id ? templateNames.get(r.template_id as string) ?? null : null, rule: r.rule_id ? ruleById.get(r.rule_id as string) ?? null : null })),
    });
  } catch (error) {
    return templateError(error, 'load drafts of');
  }
}
