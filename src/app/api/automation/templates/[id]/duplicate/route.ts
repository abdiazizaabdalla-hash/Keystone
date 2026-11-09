import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser } from '@/lib/automation/server';
import { getTemplate, saveTemplate } from '@/lib/automation/instances';

// POST: makes a new, separate automation from one of the caller's own ("Name (copy)"). It starts with no deals.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAutomationUser(request);
    const t = await getTemplate(user.id, (await params).id);
    if (!t) throw new AuthError('Automation not found', 404);
    const copy = await saveTemplate(user.id, { name: `${t.name} (copy)`.slice(0, 120), description: t.description, category: t.category, triggerType: t.trigger_type, steps: t.steps });
    return NextResponse.json({ template: copy }, { status: 201 });
  } catch (error) {
    return automationError(error, 'duplicate the automation');
  }
}
