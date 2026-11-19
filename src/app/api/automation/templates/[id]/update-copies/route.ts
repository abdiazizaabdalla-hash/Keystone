import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser } from '@/lib/automation/server';
import { getTemplate, updateCopiesFromTemplate } from '@/lib/automation/instances';

// POST: the explicit "update the running copies to the latest version". Editing a template never does this by itself.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAutomationUser(request);
    const id = (await params).id;
    if (!(await getTemplate(user.id, id))) throw new AuthError('Automation not found', 404);
    return NextResponse.json({ updated: await updateCopiesFromTemplate(user.id, id) });
  } catch (error) {
    return automationError(error, 'update the copies');
  }
}
