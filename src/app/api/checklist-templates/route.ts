import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getVisibleTcUserIds } from '@/lib/team';
import { getPlanLimits } from '@/lib/plans';
import {
  BASELINE_CHECKLIST_TEMPLATE,
  ChecklistTemplateSummary,
  normalizeTemplateSteps,
  validateTemplateName,
  validateTemplateSteps,
} from '@/lib/checklistTemplates';

/**
 * Lists checklist templates available to the caller: the free baseline
 * template plus any custom ones. Custom-template *visibility* follows the
 * same rule as agents/transactions (see getVisibleTcUserIds): a Team
 * owner sees their whole team's templates, everyone else sees only their
 * own. `customChecklists` tells the frontend whether this account's plan
 * can *author* new templates -- the baseline is always listed and always
 * usable regardless of plan.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const { customChecklists } = getPlanLimits(user.user_metadata?.plan);

    const visibleIds = await getVisibleTcUserIds(user.id);
    const { data, error } = await supabaseServer
      .from('checklist_templates')
      .select('*')
      .in('tc_user_id', visibleIds)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const templates: ChecklistTemplateSummary[] = [
      BASELINE_CHECKLIST_TEMPLATE,
      ...(data || []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        steps: normalizeTemplateSteps(row.steps),
        isBaseline: false,
        ownerUserId: row.tc_user_id as string,
      })),
    ];

    return NextResponse.json({ templates, customChecklists });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching checklist templates:', error);
    return NextResponse.json({ error: 'Failed to fetch checklist templates' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const { customChecklists } = getPlanLimits(user.user_metadata?.plan);

    if (!customChecklists) {
      return NextResponse.json(
        {
          error: 'Custom checklist templates are a Pro and Team plan feature. Upgrade to build your own workflow.',
          code: 'plan_feature_locked',
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const name = validateTemplateName(body.name);
    const steps = validateTemplateSteps(body.steps);

    if (!name) {
      return NextResponse.json({ error: 'Please enter a template name' }, { status: 400 });
    }
    if (!steps) {
      return NextResponse.json({ error: 'A template needs between 1 and 20 named steps' }, { status: 400 });
    }

    const { data, error } = await supabaseServer
      .from('checklist_templates')
      .insert({ tc_user_id: user.id, name, steps })
      .select()
      .single();

    if (error) throw error;

    const template: ChecklistTemplateSummary = {
      id: data.id,
      name: data.name,
      steps: data.steps,
      isBaseline: false,
      ownerUserId: data.tc_user_id,
    };

    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error creating checklist template:', error);
    return NextResponse.json({ error: 'Failed to create checklist template' }, { status: 500 });
  }
}
