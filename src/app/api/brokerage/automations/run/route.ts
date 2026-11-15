import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { assertBrokerageManageable } from '@/lib/brokerageAccount';
import { resolveOversightActor } from '@/lib/brokerageAdminsServer';
import { isAutomationKind } from '@/lib/brokerageAutomationRules';
import { runForOwner } from '@/lib/brokerageAutomations';

// POST { kind } or { workflowId }: check one rule or workflow now instead of waiting for the morning run. Anyone already told is not told again.
export async function POST(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveOversightActor(caller, 'full');
    await assertBrokerageManageable(user.id);
    const body = (await request.json().catch(() => ({}))) as { kind?: unknown; workflowId?: unknown };
    const workflowId = typeof body.workflowId === 'string' && /^[0-9a-f-]{36}$/i.test(body.workflowId) ? body.workflowId : null;
    if (!workflowId && !isAutomationKind(body.kind)) throw new AuthError('Unknown automation', 400);
    const [result] = await runForOwner(user.id, todayIso(), workflowId ? `wf:${workflowId}` : (body.kind as string));
    return NextResponse.json({ result: result ?? { summary: 'Save and switch it on first.', status: 'nothing', flagged: 0, emails: 0, items: [] } });
  } catch (error) {
    return oversightError(error, 'run the automation');
  }
}
