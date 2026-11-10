import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser } from '@/lib/automation/server';
import { emailWithAi } from '@/lib/automation/builder';

// POST { instruction, subject?, message?, context? }: writes or rewrites one automation email using only the known placeholders.
// Returns text for the person to read and edit; nothing is saved or sent.
const REFUSALS = { feature_off: 'Automation is not switched on.', monthly_cap_reached: 'You have used this month\'s AI allowance for automations.', model_error: 'The assistant is unavailable right now. Try again in a moment.' } as const;

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const body = await request.json().catch(() => ({}));
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (instruction.length < 3) throw new AuthError('Say what the email should do.', 400);
    if (instruction.length > 600) throw new AuthError('Please keep the instruction short.', 400);
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
    const out = await emailWithAi({ ownerUserId: user.id, instruction, subject: str(body.subject, 200), message: str(body.message, 5000), context: str(body.context, 300) || 'an automation email to people on a real estate deal' });
    if (!out.ok) return NextResponse.json({ error: REFUSALS[out.reason] }, { status: out.reason === 'model_error' ? 502 : 429 });
    if (!out.email) return NextResponse.json({ error: 'The assistant did not produce a usable email. Try rewording.' }, { status: 502 });
    return NextResponse.json({ subject: out.email.subject, message: out.email.message });
  } catch (error) {
    return automationError(error, 'write the email');
  }
}
