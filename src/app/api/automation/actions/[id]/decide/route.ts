import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser } from '@/lib/automation/server';
import { decideAutomationAction, supabaseActionStore } from '@/lib/automation/actions';
import { pickEdits } from '@/lib/automation/describe';

// POST { decision: 'approve' | 'reject', edited?: {...} }: approve (optionally with edits), or reject, a draft waiting for the caller.
// Only the account owner can decide. Approving asks the guard again with current facts, so a paused account, an ended trial or a
// recipient no longer on the deal is refused, not sent. Editing the recipients is checked the same way.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAutomationUser(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body.decision !== 'approve' && body.decision !== 'reject') throw new AuthError('decision must be approve or reject', 400);

    const row = await supabaseActionStore.get(id);
    if (!row || row.owner_user_id !== user.id) throw new AuthError('Not found', 404);

    const outcome = await decideAutomationAction(id, user.id, body.decision === 'reject' ? { reject: true } : body.edited ? { editedInputs: pickEdits(row.kind, row.inputs, body.edited) } : {});
    if ('error' in outcome) {
      if (outcome.error === 'not_pending') return NextResponse.json({ error: 'This draft was already decided.' }, { status: 409 });
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ status: outcome.status, reason: outcome.decision && outcome.decision.outcome !== 'allow' ? outcome.decision.reason : null });
  } catch (error) {
    return automationError(error, 'decide this draft');
  }
}
