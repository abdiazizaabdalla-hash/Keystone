import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser } from '@/lib/automation/server';
import { removeInstance, setInstanceStatus } from '@/lib/automation/instances';

// DELETE: takes one automation off one deal or listing and cancels anything it had queued. Other deals are untouched.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAutomationUser(request);
    if (!(await removeInstance(user.id, (await params).id))) throw new AuthError('Automation not found', 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return automationError(error, 'remove the automation');
  }
}

// PATCH { status: 'active' | 'paused' }: pauses or resumes one automation on one file. Pausing cancels what it had queued.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAutomationUser(request);
    const body = await request.json().catch(() => ({}));
    if (body.status !== 'active' && body.status !== 'paused') throw new AuthError('Status must be active or paused', 400);
    if (!(await setInstanceStatus(user.id, (await params).id, body.status))) throw new AuthError('Automation not found', 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return automationError(error, 'change the automation');
  }
}
