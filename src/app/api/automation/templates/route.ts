import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser } from '@/lib/automation/server';
import { listTemplates, saveTemplate, validateDefinition } from '@/lib/automation/instances';

// GET: the caller's saved automations with how many deals use each and how their runs went.
// POST: saves a new one. The body is checked against the catalog in library.ts; anything outside it is refused.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    return NextResponse.json({ templates: await listTemplates(user.id) });
  } catch (error) {
    return automationError(error, 'load your automations');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    const checked = validateDefinition(await request.json().catch(() => ({})));
    if (!checked.ok) throw new AuthError(checked.error, 400);
    return NextResponse.json({ template: await saveTemplate(user.id, checked.value) }, { status: 201 });
  } catch (error) {
    return automationError(error, 'save the automation');
  }
}
