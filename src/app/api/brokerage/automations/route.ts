import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { agentLabels, brokerageOn, listOwnerLinks } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { assertBrokerageManageable } from '@/lib/brokerageAccount';
import { resolveBrokerageActor } from '@/lib/brokerageAdminsServer';
import { AUTOMATIONS, cleanParams, defaultParams, defOf, describeWorkflow, isAutomationKind } from '@/lib/brokerageAutomationRules';
import { loadConfigs, loadWorkflows } from '@/lib/brokerageAutomations';

// The brokerage's automations. The owner and a managing account change them; narrower administrators can not.
//   GET                                          -> every rule with its settings, the agents, and the recent runs
//   PUT { kind, enabled, params, agentIds, notifyAgents } -> save one rule
export async function GET(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    const { owner: user } = await resolveBrokerageActor(caller, 'full');
    const [configs, links, workflows] = await Promise.all([loadConfigs(user.id), listOwnerLinks(user.id), loadWorkflows(user.id)]);
    let runsRes = await supabaseServer.from('brokerage_automation_runs').select('id, kind, label, workflow_id, ran_at, status, flagged, emails, summary, detail').eq('owner_user_id', user.id).order('ran_at', { ascending: false }).limit(40);
    // Before add-brokerage-workflows.sql runs there is no label or detail column.
    if (runsRes.error) runsRes = await supabaseServer.from('brokerage_automation_runs').select('id, kind, ran_at, status, flagged, emails, summary').eq('owner_user_id', user.id).order('ran_at', { ascending: false }).limit(40) as unknown as typeof runsRes;
    if (runsRes.error && runsRes.error.code !== 'PGRST205' && runsRes.error.code !== '42P01') throw runsRes.error;
    const ids = links.filter((l) => l.status === 'active' && l.agent_user_id).map((l) => l.agent_user_id as string);
    const labels = await agentLabels(ids);
    // The deal types an owner can limit a workflow to: the checklist templates their agents' deals use.
    const types = new Set<string>();
    if (ids.length) {
      const { data: tx } = await supabaseServer.from('transactions').select('checklist_template_name').in('tc_user_id', ids).not('checklist_template_name', 'is', null).limit(2000);
      for (const r of tx ?? []) if (r.checklist_template_name) types.add(r.checklist_template_name as string);
    }
    return NextResponse.json({
      automations: AUTOMATIONS.map((a) => {
        const c = configs.get(a.kind);
        return { ...a, enabled: c?.enabled === true, settings: { ...defaultParams(a.kind), ...(c?.params ?? {}) }, agentIds: c?.agentIds ?? [], notifyAgents: c?.notifyAgents !== false };
      }),
      workflows: workflows.map((w) => ({ ...w, description: describeWorkflow(w) })),
      dealTypes: [...types].sort(),
      agents: ids.map((id) => ({ id, name: labels.get(id)?.name ?? 'Agent' })),
      runs: runsRes.data ?? [],
    });
  } catch (error) {
    return oversightError(error, 'load your automations');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    const { owner: user } = await resolveBrokerageActor(caller, 'full');
    await assertBrokerageManageable(user.id);
    const body = (await request.json().catch(() => ({}))) as { kind?: unknown; enabled?: unknown; params?: unknown; agentIds?: unknown; notifyAgents?: unknown };
    if (!isAutomationKind(body.kind)) throw new AuthError('Unknown automation', 400);
    const links = await listOwnerLinks(user.id);
    const mine = new Set(links.filter((l) => l.agent_user_id).map((l) => l.agent_user_id as string));
    // Only this brokerage's own agents can be chosen.
    const agentIds = Array.isArray(body.agentIds) ? [...new Set(body.agentIds.filter((v): v is string => typeof v === 'string' && mine.has(v)))] : [];
    const row = {
      owner_user_id: user.id,
      kind: body.kind,
      enabled: body.enabled === true,
      params: cleanParams(body.kind, body.params),
      agent_ids: agentIds,
      notify_agents: defOf(body.kind).agentNotice ? body.notifyAgents !== false : false,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseServer.from('brokerage_automations').upsert(row, { onConflict: 'owner_user_id,kind' });
    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') throw new AuthError('The database needs one more update before automations work. Run add-brokerage-automations.sql in Supabase.', 500);
      throw error;
    }
    await logAudit(request, user, 'brokerage.automation', { entityType: 'brokerage', entityId: user.id, metadata: { kind: body.kind, enabled: row.enabled } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return oversightError(error, 'save the automation');
  }
}
