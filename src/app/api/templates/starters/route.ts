import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { requireTemplatesUser, templateError } from '@/lib/templatesServer';
import { STARTER_TEMPLATES } from '@/lib/templateStarters';

// GET: the built-in starter templates and which ones are already in your library.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { data, error } = await supabaseServer.from('doc_templates').select('starter_key').eq('owner_user_id', user.id).not('starter_key', 'is', null);
    if (error) throw error;
    const have = new Set((data || []).map((r) => r.starter_key as string));
    return NextResponse.json(
      STARTER_TEMPLATES.map((t) => ({ key: t.key, kind: t.kind, name: t.name, description: t.description, category: t.category, installed: have.has(t.key), suggestedRule: t.suggestedRule ?? null }))
    );
  } catch (error) {
    return templateError(error, 'load');
  }
}

// POST { keys?: string[] }: copy starters (all of them when no keys are given) into your library. Safe to repeat.
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request, 'custom_templates');
    const body = (await request.json().catch(() => ({}))) as { keys?: unknown };
    const wanted = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string') : null;
    const { data: existing, error: existingError } = await supabaseServer.from('doc_templates').select('starter_key').eq('owner_user_id', user.id).not('starter_key', 'is', null);
    if (existingError) throw existingError;
    const have = new Set((existing || []).map((r) => r.starter_key as string));
    const rows = STARTER_TEMPLATES.filter((t) => (!wanted || wanted.includes(t.key)) && !have.has(t.key)).map((t) => ({
      owner_user_id: user.id,
      kind: t.kind,
      name: t.name,
      description: t.description,
      category: t.category,
      subject: t.subject ?? null,
      body: t.body,
      starter_key: t.key,
      states: [] as string[],
    }));
    if (rows.length > 0) {
      const { data: inserted, error } = await supabaseServer.from('doc_templates').insert(rows).select('id, starter_key');
      if (error) throw error;
      // Each starter that has a sensible automatic rule gets it, switched OFF. Turning it on is the person's choice.
      const rules = (inserted || []).flatMap((row) => {
        const starter = STARTER_TEMPLATES.find((t) => t.key === row.starter_key);
        if (!starter?.suggestedRule) return [];
        const r = starter.suggestedRule;
        return [{ owner_user_id: user.id, template_id: row.id, enabled: false, trigger_event: r.trigger, offset_days: r.offsetDays, repeat_yearly: r.repeatYearly === true, recipient_roles: r.roles }];
      });
      if (rules.length > 0) {
        const { error: ruleError } = await supabaseServer.from('template_rules').insert(rules);
        if (ruleError) console.error('starter rules not added:', ruleError);
      }
    }
    return NextResponse.json({ added: rows.length });
  } catch (error) {
    return templateError(error, 'add');
  }
}
