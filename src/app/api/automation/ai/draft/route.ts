import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser } from '@/lib/automation/server';
import { draftWithAi } from '@/lib/automation/builder';

// POST { request, category? }: turns plain English into a DRAFT automation (or questions, or what cannot be done). Nothing is
// saved or run: the person reviews the draft in the editor and saves it themselves. Counts against the monthly AI allowance.
const REFUSALS = { feature_off: 'Automation is not switched on.', monthly_cap_reached: 'You have used this month\'s AI allowance for automations.', model_error: 'The assistant is unavailable right now. Try again in a moment.' } as const;

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const body = await request.json().catch(() => ({}));
    const text = typeof body.request === 'string' ? body.request.trim() : '';
    if (text.length < 8) throw new AuthError('Describe what the automation should do.', 400);
    if (text.length > 1500) throw new AuthError('Please keep the description under 1,500 characters.', 400);
    const category = body.category === 'transaction' || body.category === 'listing' ? body.category : undefined;
    const out = await draftWithAi({ ownerUserId: user.id, request: text, category });
    if (!out.ok) return NextResponse.json({ error: REFUSALS[out.reason] }, { status: out.reason === 'model_error' ? 502 : 429 });
    return NextResponse.json({ draft: out.draft, questions: out.questions, unsupported: out.unsupported, problem: out.problem });
  } catch (error) {
    return automationError(error, 'draft the automation');
  }
}
