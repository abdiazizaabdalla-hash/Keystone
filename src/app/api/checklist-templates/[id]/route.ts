import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getPlanLimits } from '@/lib/plans';
import { normalizeTemplateSteps, validateTemplateName, validateTemplateSteps } from '@/lib/checklistTemplates';
import { getUserPlan } from '@/lib/privileged';

/**
 * Only the TC who created a template can edit or delete it -- even for a
 * Team owner who can *see* their whole team's templates via GET
 * /api/checklist-templates, mutation stays creator-only, matching how
 * agents/transactions are scoped everywhere else in this codebase.
 */
async function loadOwnedTemplate(id: string, userId: string) {
  const { data, error } = await supabaseServer
    .from('checklist_templates')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  if (data.tc_user_id !== userId) return null;
  return data;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);
    const { customChecklists } = getPlanLimits(getUserPlan(user));

    if (!customChecklists && !isAdmin) {
      return NextResponse.json(
        { error: 'Custom checklist templates are a Pro and Team plan feature.', code: 'plan_feature_locked' },
        { status: 403 }
      );
    }

    const existing = isAdmin
      ? (await supabaseServer.from('checklist_templates').select('*').eq('id', id).single()).data
      : await loadOwnedTemplate(id, user.id);

    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.name !== undefined) {
      const name = validateTemplateName(body.name);
      if (!name) return NextResponse.json({ error: 'Please enter a template name' }, { status: 400 });
      updates.name = name;
    }
    if (body.steps !== undefined) {
      const steps = validateTemplateSteps(body.steps);
      if (!steps) return NextResponse.json({ error: 'A template needs between 1 and 20 named steps' }, { status: 400 });
      updates.steps = steps;
    }

    const { data, error } = await supabaseServer
      .from('checklist_templates')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      id: data.id,
      name: data.name,
      steps: normalizeTemplateSteps(data.steps),
      isBaseline: false,
      ownerUserId: data.tc_user_id,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating checklist template:', error);
    return NextResponse.json({ error: 'Failed to update checklist template' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);

    const existing = isAdmin
      ? (await supabaseServer.from('checklist_templates').select('*').eq('id', id).single()).data
      : await loadOwnedTemplate(id, user.id);

    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Transactions that already used this template keep their own task
    // names as-is (see checklist_templates' schema comment) -- deleting a
    // template never touches past transactions, only future ones.
    const { error } = await supabaseServer.from('checklist_templates').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error deleting checklist template:', error);
    return NextResponse.json({ error: 'Failed to delete checklist template' }, { status: 500 });
  }
}
