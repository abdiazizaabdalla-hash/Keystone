import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { automationError, requireAutomationUser } from '@/lib/automation/server';
import { deleteTemplate, getTemplate, saveTemplate, setTemplateActive, validateDefinition } from '@/lib/automation/instances';

type Ctx = { params: Promise<{ id: string }> };

// GET one of the caller's automations. PUT edits it (copies already running on deals are NOT changed; use update-copies).
// PATCH { active } switches it on or off: off pauses its copies and cancels what they had queued. DELETE removes it and stops its copies.
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { user } = await requireAutomationUser(request);
    const t = await getTemplate(user.id, (await params).id);
    if (!t) throw new AuthError('Automation not found', 404);
    return NextResponse.json({ template: t });
  } catch (error) {
    return automationError(error, 'load the automation');
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { user } = await requireAutomationUser(request);
    const id = (await params).id;
    if (!(await getTemplate(user.id, id))) throw new AuthError('Automation not found', 404);
    const checked = validateDefinition(await request.json().catch(() => ({})));
    if (!checked.ok) throw new AuthError(checked.error, 400);
    return NextResponse.json({ template: await saveTemplate(user.id, checked.value, id) });
  } catch (error) {
    return automationError(error, 'save the automation');
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { user } = await requireAutomationUser(request);
    const id = (await params).id;
    const body = await request.json().catch(() => ({}));
    if (typeof body.active !== 'boolean') throw new AuthError('active must be true or false', 400);
    if (!(await getTemplate(user.id, id))) throw new AuthError('Automation not found', 404);
    await setTemplateActive(user.id, id, body.active);
    return NextResponse.json({ ok: true, active: body.active });
  } catch (error) {
    return automationError(error, 'switch the automation');
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { user } = await requireAutomationUser(request);
    const id = (await params).id;
    if (!(await getTemplate(user.id, id))) throw new AuthError('Automation not found', 404);
    return NextResponse.json({ ok: true, stoppedCopies: await deleteTemplate(user.id, id) });
  } catch (error) {
    return automationError(error, 'delete the automation');
  }
}
