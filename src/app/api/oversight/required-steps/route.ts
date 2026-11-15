import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { assertBrokerageManageable } from '@/lib/brokerageAccount';
import { resolveBrokerageActor } from '@/lib/brokerageAdminsServer';
import { oversightError } from '@/lib/oversightServer';
import { applyRequiredStepsToOpenFiles, cleanRequiredSteps, isStepKind, loadRequiredSteps } from '@/lib/brokerageRequiredSteps';

// The brokerage's required steps for transactions and listings, added to every agent's files.
//   GET                          -> { transaction: [{name, dueDays}], listing: [...] }
//   PUT  { kind, steps }         -> replace one list
//   POST { apply: true }         -> add the steps to files that are already open (never twice)
export async function GET(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner } = await resolveBrokerageActor(caller, 'view');
    return NextResponse.json(await loadRequiredSteps(owner.id));
  } catch (error) {
    return oversightError(error, 'load the required steps');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner } = await resolveBrokerageActor(caller, 'compliance');
    await assertBrokerageManageable(owner.id);
    const body = (await request.json().catch(() => ({}))) as { kind?: unknown; steps?: unknown };
    if (!isStepKind(body.kind)) return NextResponse.json({ error: 'Choose transactions or listings.' }, { status: 400 });
    const steps = cleanRequiredSteps(body.steps);
    const { error: delErr } = await supabaseServer.from('brokerage_required_steps').delete().eq('owner_user_id', owner.id).eq('kind', body.kind);
    if (delErr) throw delErr;
    if (steps.length) {
      const { error } = await supabaseServer.from('brokerage_required_steps').insert(steps.map((s, i) => ({ owner_user_id: owner.id, kind: body.kind, name: s.name, due_days: s.dueDays, position: i })));
      if (error) throw error;
    }
    await logAudit(request, owner, 'brokerage.required_steps', { entityType: 'brokerage', entityId: owner.id, metadata: { kind: body.kind, count: steps.length } });
    return NextResponse.json({ steps });
  } catch (error) {
    return oversightError(error, 'save the required steps');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner } = await resolveBrokerageActor(caller, 'compliance');
    await assertBrokerageManageable(owner.id);
    const body = (await request.json().catch(() => ({}))) as { apply?: unknown };
    if (body.apply !== true) return NextResponse.json({ error: 'Nothing to do.' }, { status: 400 });
    const result = await applyRequiredStepsToOpenFiles(owner.id);
    await logAudit(request, owner, 'brokerage.required_steps_apply', { entityType: 'brokerage', entityId: owner.id, metadata: result });
    return NextResponse.json(result);
  } catch (error) {
    return oversightError(error, 'add the required steps to open files');
  }
}
