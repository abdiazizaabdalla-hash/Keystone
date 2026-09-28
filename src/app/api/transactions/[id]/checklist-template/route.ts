import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { getPlanLimits } from '@/lib/plans';
import { getVisibleTcUserIds } from '@/lib/team';
import {
  BASELINE_TEMPLATE_ID,
  BASELINE_CHECKLIST_TEMPLATE,
  ChecklistTemplateStep,
  normalizeTemplateSteps,
} from '@/lib/checklistTemplates';
import { computeDueDates, NO_DUE_DATE, DueDateSpec } from '@/lib/dueDates';

/**
 * Switches an existing transaction onto a different checklist template.
 * This replaces its tasks wholesale (the new template's steps, all
 * unchecked) and resets status back to 'Contract Pending', since there's
 * no sound way to carry partial progress across two checklists that may
 * not share step names. Blocked once a transaction is 'Closed' — that
 * status already has a generated invoice tied to it, and switching the
 * checklist out from under a closed deal would leave the two out of sync
 * with nothing to reconcile them.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: transactionId } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const body = await request.json();
    const { templateId } = body;

    if (!templateId) {
      return NextResponse.json({ error: 'templateId is required' }, { status: 400 });
    }

    const { data: transaction, error: txFetchError } = await supabaseServer
      .from('transactions')
      .select('id, agent_id, status, checklist_template_name, acceptance_date, closing_date')
      .eq('id', transactionId)
      .single();

    if (txFetchError || !transaction) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (!isAdmin) {
      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', transaction.agent_id)
        .eq('tc_user_id', user.id)
        .single();

      if (!agent) {
        return NextResponse.json({ error: 'You do not have permission to update this transaction' }, { status: 403 });
      }
    }

    if (transaction.status === 'Closed') {
      return NextResponse.json(
        { error: "Can't change the checklist template on a closed deal." },
        { status: 400 }
      );
    }

    // Resolve the requested template — same validation as picking one at
    // transaction-creation time (plan gate + visibility check).
    let templateSteps: ChecklistTemplateStep[] = BASELINE_CHECKLIST_TEMPLATE.steps;
    let templateName: string = BASELINE_CHECKLIST_TEMPLATE.name;

    if (templateId !== BASELINE_TEMPLATE_ID) {
      const { customChecklists } = getPlanLimits(user.user_metadata?.plan);
      if (!customChecklists) {
        return NextResponse.json(
          { error: 'Custom checklist templates are a Pro and Team plan feature.', code: 'plan_feature_locked' },
          { status: 403 }
        );
      }

      const visibleIds = await getVisibleTcUserIds(user.id);
      const { data: template } = await supabaseServer
        .from('checklist_templates')
        .select('name, steps, tc_user_id')
        .eq('id', templateId)
        .single();

      if (!template || !visibleIds.includes(template.tc_user_id)) {
        return NextResponse.json({ error: 'Checklist template not found' }, { status: 400 });
      }

      const steps = normalizeTemplateSteps(template.steps);
      if (steps.length > 0) {
        templateSteps = steps;
        templateName = template.name;
      }
    }

    if (templateName === transaction.checklist_template_name) {
      return NextResponse.json({ error: 'This transaction already uses that checklist template.' }, { status: 400 });
    }

    // Clear any documents' links to the old tasks before removing them —
    // there's no FK in this schema to cascade it, and a dangling task_id
    // would just make a document's "Checklist Stage" tag silently vanish.
    // The documents themselves are untouched either way.
    const { data: oldTasks } = await supabaseServer
      .from('tasks')
      .select('id')
      .eq('transaction_id', transactionId);
    const oldTaskIds = (oldTasks || []).map((t) => t.id);
    if (oldTaskIds.length > 0) {
      await supabaseServer.from('documents').update({ task_id: null }).in('task_id', oldTaskIds);
    }

    const { error: deleteError } = await supabaseServer.from('tasks').delete().eq('transaction_id', transactionId);
    if (deleteError) throw deleteError;

    // due_date is computed the same way as at initial transaction
    // creation (see /api/transactions POST) -- comes back all-null if
    // this transaction has no acceptance_date yet, which is a harmless
    // no-op. due_days_after_acceptance is snapshotted alongside it so a
    // later acceptance/closing date edit can recompute without needing
    // this template again.
    // Same due-date resolution as creating a new transaction (see
    // /api/transactions POST): this TC's own due-date workflow decides
    // Baseline steps' due dates (or turns them all off), a custom
    // template's own per-step rule is used otherwise.
    const workflowEnabled = user.user_metadata?.due_date_workflow_enabled === true;
    const rawWorkflowSteps = user.user_metadata?.due_date_workflow_steps;
    const workflowStepsByName = new Map<string, DueDateSpec>(
      (Array.isArray(rawWorkflowSteps) ? normalizeTemplateSteps(rawWorkflowSteps) : BASELINE_CHECKLIST_TEMPLATE.steps).map(
        (s) => [s.name, s.dueDate ?? { ...NO_DUE_DATE }]
      )
    );
    const resolvedSteps = templateSteps.map((step) => {
      if (!workflowEnabled) return { name: step.name, dueDate: { ...NO_DUE_DATE } };
      const dueDate = workflowStepsByName.get(step.name) ?? step.dueDate ?? { ...NO_DUE_DATE };
      return { name: step.name, dueDate };
    });

    const dueDates = computeDueDates(resolvedSteps, transaction.acceptance_date, transaction.closing_date);
    const newTasks = resolvedSteps.map((step, index) => ({
      transaction_id: transactionId,
      name: step.name,
      completed: false,
      sort_order: index,
      due_date: dueDates[index],
      due_date_spec: step.dueDate,
      due_days_after_acceptance: step.dueDate.mode === 'after_acceptance' ? step.dueDate.days ?? null : null,
    }));

    const { data: insertedTasks, error: insertError } = await supabaseServer
      .from('tasks')
      .insert(newTasks)
      .select()
      .order('sort_order', { ascending: true });
    if (insertError) throw insertError;

    const { data: updatedTransaction, error: updateError } = await supabaseServer
      .from('transactions')
      .update({
        status: 'Contract Pending',
        checklist_template_name: templateName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', transactionId)
      .select()
      .single();
    if (updateError) throw updateError;

    return NextResponse.json({ ...updatedTransaction, tasks: insertedTasks || [] });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TrialExpiredError) {
      return NextResponse.json(
        { error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt },
        { status: error.status }
      );
    }
    console.error('Error switching checklist template:', error);
    return NextResponse.json({ error: 'Failed to switch checklist template' }, { status: 500 });
  }
}
