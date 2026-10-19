import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { LIMITS, stepKey } from '@/lib/stepEmailTemplates';

// A TC's saved email templates, one per checklist step name.
// GET: all of mine ({ templates: { [stepKey]: { subject, body } } }).
// PUT: save/replace one ({ stepName, subject, body }).
// DELETE: ?stepName=... resets that step back to Relay's default.

async function requireTc(request: NextRequest) {
  const { user } = await getUserFromRequest(request);
  if (isAgentUser(user)) throw new AuthError('Not available', 403);
  return user;
}

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`Error ${what} step email template:`, error);
  return NextResponse.json({ error: `Failed to ${what} template` }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireTc(request);
    const { data, error } = await supabaseServer
      .from('step_email_templates')
      .select('step_key, subject, body')
      .eq('tc_user_id', user.id);
    if (error) throw error;
    const templates: Record<string, { subject: string; body: string }> = {};
    for (const row of data || []) templates[row.step_key as string] = { subject: row.subject as string, body: row.body as string };
    return NextResponse.json({ templates });
  } catch (error) {
    return fail(error, 'load');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireTc(request);
    const body = await request.json().catch(() => ({}));
    const key = typeof body.stepName === 'string' ? stepKey(body.stepName) : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!key) return NextResponse.json({ error: 'stepName is required' }, { status: 400 });
    if (!subject || subject.length > LIMITS.subject) {
      return NextResponse.json({ error: `Subject must be 1-${LIMITS.subject} characters` }, { status: 400 });
    }
    if (!text || text.length > LIMITS.body) {
      return NextResponse.json({ error: `Message must be 1-${LIMITS.body} characters` }, { status: 400 });
    }
    const { error } = await supabaseServer
      .from('step_email_templates')
      .upsert(
        { tc_user_id: user.id, step_key: key, subject, body: text, updated_at: new Date().toISOString() },
        { onConflict: 'tc_user_id,step_key' }
      );
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, 'save');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireTc(request);
    const name = new URL(request.url).searchParams.get('stepName') || '';
    const key = stepKey(name);
    if (!key) return NextResponse.json({ error: 'stepName is required' }, { status: 400 });
    const { error } = await supabaseServer.from('step_email_templates').delete().eq('tc_user_id', user.id).eq('step_key', key);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, 'reset');
  }
}
