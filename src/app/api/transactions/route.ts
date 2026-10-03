import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { TRANSACTION_STAGES } from '@/lib/transactionStages';
import { getPlanLimits } from '@/lib/plans';
import { getVisibleTcUserIds, getTeamForUser } from '@/lib/team';
import {
  BASELINE_TEMPLATE_ID,
  BASELINE_CHECKLIST_TEMPLATE,
  ChecklistTemplateStep,
  normalizeTemplateSteps,
} from '@/lib/checklistTemplates';
import { computeDueDates, NO_DUE_DATE, DueDateSpec } from '@/lib/dueDates';
import crypto from 'crypto';

const CLOSED_STATUS = TRANSACTION_STAGES[TRANSACTION_STAGES.length - 1]; // 'Closed'

// A short, URL/email-safe token for this transaction's inbound-email
// address (deal-<token>@<inbound domain> -- see
// src/app/api/email/inbound/route.ts). 8 hex chars is plenty unique for
// something a human copy-pastes rather than memorizes; the DB-level
// UNIQUE constraint on transactions.inbound_token is what actually
// guarantees no collision, this is just picking a fresh guess each try.
function generateInboundToken(): string {
  return crypto.randomBytes(4).toString('hex');
}

export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);

    let query = supabaseServer
      .from('transactions')
      .select('*')
      .order('created_at', { ascending: false });

    if (!isAdmin) {
      // transactions.tc_user_id is the explicit, reassignable "who's
      // running this deal" column (see add-brokerage-org.sql) -- filtering
      // on it directly, instead of resolving through agent_id ->
      // agents.tc_user_id, is both simpler and correct once a transaction
      // can be reassigned to a TC other than whoever owns its agent
      // contact.
      const visibleIds = await getVisibleTcUserIds(user.id);
      query = query.in('tc_user_id', visibleIds);
    }

    const { data, error } = await query;

    if (error) throw error;

    if (!data || data.length === 0) {
      return NextResponse.json(data);
    }

    // Attach a lightweight due-date summary to each transaction -- the
    // earliest incomplete task's due_date, and how many incomplete tasks
    // are already overdue -- so the transactions list can flag deals that
    // need attention without the frontend having to fetch every
    // transaction's full checklist. See dashboard/transactions/page.tsx.
    const todayStr = new Date().toISOString().split('T')[0];
    const txIds = data.map((t) => t.id as string);
    const { data: openTasks } = await supabaseServer
      .from('tasks')
      .select('transaction_id, due_date')
      .in('transaction_id', txIds)
      .eq('completed', false)
      .not('due_date', 'is', null);

    const summaryByTx = new Map<string, { nextDueDate: string; overdueCount: number }>();
    (openTasks || []).forEach((t) => {
      const txId = t.transaction_id as string;
      const dueDate = t.due_date as string;
      const isOverdue = dueDate < todayStr;
      const existing = summaryByTx.get(txId);
      if (!existing) {
        summaryByTx.set(txId, { nextDueDate: dueDate, overdueCount: isOverdue ? 1 : 0 });
      } else {
        if (dueDate < existing.nextDueDate) existing.nextDueDate = dueDate;
        if (isOverdue) existing.overdueCount += 1;
      }
    });

    const enriched = data.map((t) => {
      const summary = summaryByTx.get(t.id as string);
      return {
        ...t,
        next_due_date: summary?.nextDueDate ?? null,
        overdue_count: summary?.overdueCount ?? 0,
      };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const body = await request.json();
    const { agentId, fileNumber, propertyAddress, purchasePrice, templateId, acceptanceDate, closingDate, leaveUnassigned } = body;

    // Brokerage/Team owner only: create the transaction without stamping
    // a tc_user_id at all, for a deal that's come in but hasn't been
    // handed to a specific TC yet. Shows up in the owner's "Unassigned"
    // queue (see /api/team/unassigned) until someone claims it -- see
    // add-brokerage-org.sql for why tc_user_id is nullable to begin with.
    // Regular members can never do this; it's meaningless for a solo TC.
    let assignUnassigned = false;
    if (leaveUnassigned === true) {
      const membership = await getTeamForUser(user.id);
      if (!membership || membership.role !== 'owner') {
        return NextResponse.json({ error: 'Only the team owner can leave a transaction unassigned' }, { status: 403 });
      }
      assignUnassigned = true;
    }

    if (!isAdmin) {
      const { data: agent } = await supabaseServer
        .from('agents')
        .select('id, tc_user_id')
        .eq('id', agentId)
        .single();

      const visibleIds = await getVisibleTcUserIds(user.id);
      if (!agent || !visibleIds.includes(agent.tc_user_id)) {
        return NextResponse.json({ error: 'Agent not found or does not belong to you' }, { status: 403 });
      }
    }

    // Plan-gated: kept generic (maxActiveTransactions can be null) even
    // though no current plan actually caps transactions -- Starter's only
    // real limit these days is agent profiles. This block is a no-op
    // until/unless a future plan reintroduces a transaction cap.
    const { maxActiveTransactions } = getPlanLimits(user.user_metadata?.plan);
    if (maxActiveTransactions !== null) {
      const { count, error: countError } = await supabaseServer
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('tc_user_id', user.id)
        .neq('status', CLOSED_STATUS);

      if (countError) throw countError;

      if ((count || 0) >= maxActiveTransactions) {
        return NextResponse.json(
          {
            error: `Your plan allows up to ${maxActiveTransactions} active transactions. Close out an existing deal or upgrade to add more.`,
            code: 'plan_limit_reached',
          },
          { status: 403 }
        );
      }
    }

    // Resolve the chosen checklist template (the baseline by default)
    // BEFORE creating the transaction row, so a bad/locked template
    // request fails clean instead of leaving an orphaned transaction with
    // no tasks. checklist_template_name is snapshotted onto the
    // transaction itself (display only) so it keeps showing correctly
    // even if the template is later renamed or deleted.
    let templateSteps: ChecklistTemplateStep[] = BASELINE_CHECKLIST_TEMPLATE.steps;
    let templateName: string = BASELINE_CHECKLIST_TEMPLATE.name;

    if (templateId && templateId !== BASELINE_TEMPLATE_ID) {
      const { customChecklists } = getPlanLimits(user.user_metadata?.plan);
      if (!customChecklists) {
        return NextResponse.json(
          { error: 'Custom checklist templates are a Pro and Team plan feature.', code: 'plan_feature_locked' },
          { status: 403 }
        );
      }

      // A custom template must belong to someone whose data this user can
      // see (themselves, or their whole team if they're a Team owner) --
      // same visibility rule as agents/transactions.
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

    // Create transaction. Retries a handful of times on an inbound_token
    // collision (astronomically unlikely with 32 bits of randomness, but
    // the UNIQUE constraint is what actually guarantees safety, not the
    // odds -- see add-email-ingestion.sql) rather than ever reusing one.
    let transaction: ({ id: string; agent_id: string } & Record<string, unknown>) | null = null;
    let txError: { code?: string; message?: string } | null = null;
    for (let attempt = 0; attempt < 5 && !transaction; attempt++) {
      const result = await supabaseServer
        .from('transactions')
        .insert({
          agent_id: agentId,
          tc_user_id: assignUnassigned ? null : user.id,
          file_number: fileNumber,
          property_address: propertyAddress,
          purchase_price: purchasePrice,
          status: 'Contract Pending',
          checklist_template_name: templateName,
          acceptance_date: acceptanceDate || null,
          closing_date: closingDate || null,
          inbound_token: generateInboundToken(),
        })
        .select()
        .single();

      if (!result.error) {
        transaction = result.data;
        txError = null;
        break;
      }

      txError = result.error;
      // 23505 = unique_violation. Only worth retrying if it's specifically
      // the token column -- any other constraint failing means retrying
      // with a new random token would just fail the same way again.
      if (result.error.code !== '23505' || !/inbound_token/i.test(result.error.message || '')) {
        break;
      }
    }

    if (!transaction) throw txError || new Error('Failed to create transaction');

    // Resolve each step's due-date spec from this TC's own due-date
    // workflow (set up during onboarding, editable anytime in Settings --
    // see /api/auth/me) rather than assuming one. A TC can turn the whole
    // thing off, in which case every step gets no due date at all
    // regardless of template. Otherwise, a Baseline-named step uses this
    // TC's own configured rule for that name; any other (custom-template)
    // step falls back to whatever due-date rule the template itself
    // carries -- unchanged from how custom templates already worked.
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

    // Auto-create tasks from the resolved template, with an explicit
    // sort_order so the checklist <-> status sync always reads them back
    // in the right order (created_at alone isn't reliable — a bulk insert
    // can tie timestamps). due_date is a computed snapshot from the
    // acceptance/closing dates just saved above -- see computeDueDates in
    // lib/dueDates.ts. It comes back all-null when no acceptance date was
    // given yet, or when a step has no due date at all -- both are
    // harmless no-ops here. due_date_spec is itself snapshotted onto each
    // task (rather than only its computed due_date) so that a later
    // acceptance/closing date edit can recompute this task's due date
    // without needing the template again -- see the PATCH handler in
    // transactions/[id]/route.ts. due_days_after_acceptance is also kept
    // in sync for backward compatibility with any older code path still
    // reading that column directly.
    const dueDates = computeDueDates(resolvedSteps, acceptanceDate || null, closingDate || null);
    const tasks = resolvedSteps.map((step, index) => ({
      transaction_id: transaction.id,
      name: step.name,
      completed: false,
      sort_order: index,
      due_date: dueDates[index],
      due_date_spec: step.dueDate,
      due_days_after_acceptance: step.dueDate.mode === 'after_acceptance' ? step.dueDate.days ?? null : null,
    }));

    const { error: tasksError } = await supabaseServer
      .from('tasks')
      .insert(tasks)
      .select();

    if (tasksError) throw tasksError;


    return NextResponse.json(transaction, { status: 201 });
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
    console.error('Error creating transaction:', error);
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
  }
}
export async function DELETE(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
    }

    const { data: transaction, error: fetchError } = await supabaseServer
      .from('transactions')
      .select('id, agent_id')
      .eq('id', id)
      .single();

    if (fetchError || !transaction) {
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
        return NextResponse.json({ error: 'You do not have permission to delete this transaction' }, { status: 403 });
      }
    }

    // Clean up everything tied to this transaction before removing it:
    // uploaded documents (storage files + rows), tasks, and any
    // auto-generated invoice. There are no FK constraints in this schema, so
    // this has to be done manually to avoid leaving orphaned rows/files.
    const { data: docs } = await supabaseServer
      .from('documents')
      .select('storage_path')
      .eq('transaction_id', id);

    const storagePaths = (docs || []).map((d) => d.storage_path).filter(Boolean);
    if (storagePaths.length > 0) {
      const { error: storageError } = await supabaseServer.storage
        .from('transaction-documents')
        .remove(storagePaths);
      if (storageError) {
        console.warn('Warning: failed to remove some document files from storage', storageError);
      }
    }

    await supabaseServer.from('documents').delete().eq('transaction_id', id);
    await supabaseServer.from('tasks').delete().eq('transaction_id', id);
    await supabaseServer.from('invoices').delete().eq('transaction_id', id);

    const { error: deleteError } = await supabaseServer
      .from('transactions')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error deleting transaction:', error);
    return NextResponse.json({ error: 'Failed to delete transaction' }, { status: 500 });
  }
}
