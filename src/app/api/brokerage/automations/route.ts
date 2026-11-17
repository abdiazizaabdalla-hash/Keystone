import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { agentLabels } from '@/lib/oversight';
import { rosterFor } from '@/lib/oversightRoster';
import { oversightError } from '@/lib/oversightServer';
import { assertBrokerageManageable } from '@/lib/brokerageAccount';
import { resolveOversightActor } from '@/lib/brokerageAdminsServer';
import { AUTOMATIONS, cleanParams, defaultParams, defOf, describeWorkflow, isAutomationKind, kindsFor, triggersFor } from '@/lib/brokerageAutomationRules';
import { loadConfigs, loadWorkflows } from '@/lib/brokerageAutomations';

// The brokerage's automations. The owner and a managing account change them; narrower administrators can not.
//   GET                                          -> every rule with its settings, the agents, and the recent runs
//   PUT { kind, enabled, params, agentIds, notifyAgents } -> save one rule
export async function GET(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveOversightActor(caller, 'full');
    const [loadedConfigs, roster, workflows] = await Promise.all([loadConfigs(user.id), rosterFor(user.id), loadWorkflows(user.id)]);
    let configs = loadedConfigs;
    // The first visit switches every built-in rule on, the same starting point onboarding offers. After that the owner's own choices are kept.
    if (configs.size === 0) {
      try {
        await assertBrokerageManageable(user.id);
        const rows = kindsFor(roster.mode).map((kind) => ({ owner_user_id: user.id, kind, enabled: true, params: cleanParams(kind, {}), agent_ids: [] as string[], notify_agents: defOf(kind).agentNotice, updated_at: new Date().toISOString() }));
        const seed = await supabaseServer.from('brokerage_automations').upsert(rows, { onConflict: 'owner_user_id,kind', ignoreDuplicates: true });
        if (!seed.error) configs = await loadConfigs(user.id);
      } catch {
        /* an account that cannot manage yet, or tables not updated: show the rules off as before */
      }
    }
    const mode = roster.mode;
    const kinds = new Set<string>(kindsFor(mode));
    let runsRes = await supabaseServer.from('brokerage_automation_runs').select('id, kind, label, workflow_id, ran_at, status, flagged, emails, summary, detail').eq('owner_user_id', user.id).order('ran_at', { ascending: false }).limit(40);
    // Before add-brokerage-workflows.sql runs there is no label or detail column.
    if (runsRes.error) runsRes = await supabaseServer.from('brokerage_automation_runs').select('id, kind, ran_at, status, flagged, emails, summary').eq('owner_user_id', user.id).order('ran_at', { ascending: false }).limit(40) as unknown as typeof runsRes;
    if (runsRes.error && runsRes.error.code !== 'PGRST205' && runsRes.error.code !== '42P01') throw runsRes.error;
    const ids = roster.userIds;
    const labels = await agentLabels(ids);
    // The deal types an owner can limit a workflow to: the checklist templates their agents' deals use.
    const types = new Set<string>();
    if (ids.length) {
      const { data: tx } = await supabaseServer.from('transactions').select('checklist_template_name').in('tc_user_id', ids).not('checklist_template_name', 'is', null).limit(2000);
      for (const r of tx ?? []) if (r.checklist_template_name) types.add(r.checklist_template_name as string);
    }
    return NextResponse.json({
      mode,
      triggers: triggersFor(mode),
      automations: AUTOMATIONS.filter((a) => kinds.has(a.kind)).map((a) => {
        const c = configs.get(a.kind);
        return { ...a, enabled: c?.enabled === true, settings: { ...defaultParams(a.kind), ...(c?.params ?? {}) }, agentIds: c?.agentIds ?? [], notifyAgents: c?.notifyAgents !== false };
      }),
      workflows: workflows.filter((w) => mode !== 'team' || w.trigger !== 'missing_docs').map((w) => ({ ...w, description: describeWorkflow(w) })),
      dealTypes: [...types].sort(),
      agents: ids.map((id) => ({ id, name: labels.get(id)?.name ?? (mode === 'team' ? 'Coordinator' : 'Agent') })),
      runs: runsRes.data ?? [],
    });
  } catch (error) {
    return oversightError(error, 'load your automations');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveOversightActor(caller, 'full');
    await assertBrokerageManageable(user.id);
    const body = (await request.json().catch(() => ({}))) as { kind?: unknown; enabled?: unknown; params?: unknown; agentIds?: unknown; notifyAgents?: unknown };
    if (!isAutomationKind(body.kind)) throw new AuthError('Unknown automation', 400);
    const roster = await rosterFor(user.id);
    if (!kindsFor(roster.mode).includes(body.kind)) throw new AuthError('Unknown automation', 400);
    const mine = new Set(roster.userIds);
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
