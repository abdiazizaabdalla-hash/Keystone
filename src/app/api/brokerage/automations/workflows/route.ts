import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { rosterFor } from '@/lib/oversightRoster';
import { oversightError } from '@/lib/oversightServer';
import { assertBrokerageManageable } from '@/lib/brokerageAccount';
import { resolveOversightActor } from '@/lib/brokerageAdminsServer';
import { MAX_WORKFLOWS, cleanWorkflow } from '@/lib/brokerageAutomationRules';

// Workflows a broker builds. The owner and a managing account create, change and delete them.
//   POST { id?, name, trigger, amount, notifyAgent, notifyOwner, escalateDays, agentIds, dealTypes, enabled } -> create (no id) or change
//   DELETE ?id= -> remove one (what it already sent stays in the run history)
const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

export async function POST(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveOversightActor(caller, 'full');
    await assertBrokerageManageable(user.id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const roster = await rosterFor(user.id);
    const checked = cleanWorkflow(body, new Set(roster.userIds));
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    if (roster.mode === 'team' && checked.value.trigger === 'missing_docs') return NextResponse.json({ error: 'Choose another trigger.' }, { status: 400 });
    const w = checked.value;
    const row = { owner_user_id: user.id, name: w.name, trigger: w.trigger, amount: w.amount, notify_agent: w.notifyAgent, notify_owner: w.notifyOwner, escalate_days: w.escalateDays, agent_ids: w.agentIds, deal_types: w.dealTypes, enabled: w.enabled, updated_at: new Date().toISOString() };
    let id: string;
    if (isId(body.id)) {
      const { data, error } = await supabaseServer.from('brokerage_workflows').update(row).eq('id', body.id).eq('owner_user_id', user.id).select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new AuthError('Not found', 404);
      id = data.id as string;
    } else {
      const { count, error: countError } = await supabaseServer.from('brokerage_workflows').select('id', { count: 'exact', head: true }).eq('owner_user_id', user.id);
      if (countError) throw countError;
      if ((count ?? 0) >= MAX_WORKFLOWS) return NextResponse.json({ error: `You can have up to ${MAX_WORKFLOWS} workflows. Delete one you no longer use.` }, { status: 400 });
      const { data, error } = await supabaseServer.from('brokerage_workflows').insert(row).select('id').single();
      if (error) throw error;
      id = data.id as string;
    }
    await logAudit(request, user, 'brokerage.workflow_save', { entityType: 'brokerage', entityId: user.id, metadata: { workflow: id, trigger: w.trigger, enabled: w.enabled } });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    const info = error as { code?: string } | null;
    if (info && (info.code === 'PGRST205' || info.code === '42P01')) return NextResponse.json({ error: 'The database needs one more update before workflows work. Run add-brokerage-workflows.sql in Supabase.' }, { status: 500 });
    return oversightError(error, 'save the workflow');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveOversightActor(caller, 'full');
    const id = request.nextUrl.searchParams.get('id');
    if (!isId(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { error } = await supabaseServer.from('brokerage_workflows').delete().eq('id', id).eq('owner_user_id', user.id);
    if (error) throw error;
    await logAudit(request, user, 'brokerage.workflow_delete', { entityType: 'brokerage', entityId: user.id, metadata: { workflow: id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return oversightError(error, 'delete the workflow');
  }
}
