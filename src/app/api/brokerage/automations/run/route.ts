import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { brokerageOn } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { assertBrokerageManageable } from '@/lib/brokerageAccount';
import { requireBrokerageOwnerOnly } from '@/lib/brokerageAdminsServer';
import { isAutomationKind } from '@/lib/brokerageAutomationRules';
import { runForOwner } from '@/lib/brokerageAutomations';

// POST { kind }: check one rule now instead of waiting for the morning run. Anyone already told is not told again.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    await requireBrokerageOwnerOnly(user);
    await assertBrokerageManageable(user.id);
    const body = (await request.json().catch(() => ({}))) as { kind?: unknown };
    if (!isAutomationKind(body.kind)) throw new AuthError('Unknown automation', 400);
    const [result] = await runForOwner(user.id, todayIso(), body.kind);
    return NextResponse.json({ result: result ?? { kind: body.kind, status: 'nothing', flagged: 0, emails: 0, summary: 'Save the rule first.' } });
  } catch (error) {
    return oversightError(error, 'run the automation');
  }
}
