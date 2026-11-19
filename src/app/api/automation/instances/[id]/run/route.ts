import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser } from '@/lib/automation/server';
import { runNow } from '@/lib/automation/instances';

// POST { stepId? }: runs one step (or every step not yet handled) of one of the caller's automations right now. The usual rules
// still apply: the assistant mode, who can be emailed, the daily limit, and approval first while the file is on Draft.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAutomationUser(request);
    const body = await request.json().catch(() => ({}));
    const stepId = typeof body.stepId === 'string' && body.stepId ? body.stepId : null;
    const res = await runNow(user.id, (await params).id, stepId);
    if (!res.ok) {
      if (res.reason === 'not_found') throw new AuthError('Automation not found', 404);
      if (res.reason === 'unknown_step') throw new AuthError('That step is not part of this automation', 400);
      throw new AuthError('This automation is paused. Turn it back on first.', 409);
    }
    return NextResponse.json({ results: res.results });
  } catch (error) {
    return automationError(error, 'run the automation');
  }
}
