import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser } from '@/lib/automation/server';
import { removeInstance } from '@/lib/automation/instances';

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
