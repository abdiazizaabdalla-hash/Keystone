import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { DEFAULT_LISTING_STEPS, MAX_TEMPLATE_STEPS, cleanText, loadTemplateSteps } from '@/lib/listings';

// A TC's default listing checklist: GET returns it (or Relay's starter steps), PUT replaces it,
// DELETE goes back to the starter steps. New listings copy it; existing listings are never changed.
async function requireTc(request: NextRequest) {
  const { user } = await getUserFromRequest(request);
  if (isAgentUser(user)) throw new AuthError('Not available', 403);
  return user;
}

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} listing template:`, error);
  return NextResponse.json({ error: `Failed to ${what} template` }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireTc(request);
    const { count } = await supabaseServer.from('listing_template_steps').select('id', { count: 'exact', head: true }).eq('tc_user_id', user.id);
    return NextResponse.json({ steps: await loadTemplateSteps(user.id), isCustom: (count ?? 0) > 0 });
  } catch (error) {
    return fail(error, 'load');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireTc(request);
    await assertTrialActive(user);
    const body = await request.json().catch(() => ({}));
    const raw: unknown[] = Array.isArray(body.steps) ? body.steps : [];
    if (raw.length === 0 || raw.length > MAX_TEMPLATE_STEPS) {
      return NextResponse.json({ error: `Keep between 1 and ${MAX_TEMPLATE_STEPS} steps` }, { status: 400 });
    }
    const rows: { tc_user_id: string; name: string; offset_days: number; sort_order: number }[] = [];
    for (const item of raw) {
      const s = (item || {}) as { name?: unknown; offsetDays?: unknown };
      const name = cleanText(s.name, 200);
      const n = Math.round(Number(s.offsetDays));
      if (!name) return NextResponse.json({ error: 'Every step needs a name' }, { status: 400 });
      rows.push({ tc_user_id: user.id, name, offset_days: Number.isFinite(n) && Math.abs(n) < 3650 ? n : 0, sort_order: rows.length });
    }
    await supabaseServer.from('listing_template_steps').delete().eq('tc_user_id', user.id);
    const { error } = await supabaseServer.from('listing_template_steps').insert(rows);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, 'save');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireTc(request);
    await supabaseServer.from('listing_template_steps').delete().eq('tc_user_id', user.id);
    return NextResponse.json({ success: true, steps: DEFAULT_LISTING_STEPS });
  } catch (error) {
    return fail(error, 'reset');
  }
}
