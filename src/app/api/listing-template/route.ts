import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { DEFAULT_LISTING_STEPS, DEFAULT_TEMPLATE_NAME, MAX_TEMPLATES, MAX_TEMPLATE_STEPS, cleanTemplateName, cleanText, listTemplateNames, loadTemplateSteps } from '@/lib/listings';

// A TC's listing checklists. They can keep several by name (e.g. "Standard", "Luxury", "Short sale"):
// GET ?name= returns one (or Relay's starter steps for "Standard") plus the list of names, PUT replaces
// one, DELETE removes one ("Standard" goes back to the starter steps). New listings copy the template
// they pick; existing listings are never changed.
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
    const name = cleanTemplateName(request.nextUrl.searchParams.get('name'));
    const names = await listTemplateNames(user.id);
    const { count, error } = await supabaseServer
      .from('listing_template_steps')
      .select('id', { count: 'exact', head: true })
      .eq('tc_user_id', user.id)
      .eq('template_name', name);
    const isCustom = error ? name === DEFAULT_TEMPLATE_NAME : (count ?? 0) > 0;
    return NextResponse.json({ name, names, steps: await loadTemplateSteps(user.id, name), isCustom });
  } catch (error) {
    return fail(error, 'load');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireTc(request);
    await assertTrialActive(user);
    const body = await request.json().catch(() => ({}));
    const name = cleanTemplateName(body.name);
    const raw: unknown[] = Array.isArray(body.steps) ? body.steps : [];
    if (raw.length === 0 || raw.length > MAX_TEMPLATE_STEPS) {
      return NextResponse.json({ error: `Keep between 1 and ${MAX_TEMPLATE_STEPS} steps` }, { status: 400 });
    }
    const names = await listTemplateNames(user.id);
    if (!names.includes(name) && names.length >= MAX_TEMPLATES) {
      return NextResponse.json({ error: `You can keep up to ${MAX_TEMPLATES} checklists` }, { status: 400 });
    }
    const rows: { tc_user_id: string; template_name: string; name: string; offset_days: number; sort_order: number }[] = [];
    for (const item of raw) {
      const s = (item || {}) as { name?: unknown; offsetDays?: unknown };
      const stepName = cleanText(s.name, 200);
      const n = Math.round(Number(s.offsetDays));
      if (!stepName) return NextResponse.json({ error: 'Every step needs a name' }, { status: 400 });
      rows.push({ tc_user_id: user.id, template_name: name, name: stepName, offset_days: Number.isFinite(n) && Math.abs(n) < 3650 ? n : 0, sort_order: rows.length });
    }
    const del = await supabaseServer.from('listing_template_steps').delete().eq('tc_user_id', user.id).eq('template_name', name);
    if (del.error) {
      // add-listing-round3.sql not run yet: only the single default checklist can be saved.
      if (name !== DEFAULT_TEMPLATE_NAME) return NextResponse.json({ error: 'Several checklists need the latest database update (add-listing-round3.sql).' }, { status: 400 });
      await supabaseServer.from('listing_template_steps').delete().eq('tc_user_id', user.id);
      const { error } = await supabaseServer.from('listing_template_steps').insert(rows.map(({ template_name: _t, ...r }) => (void _t, r)));
      if (error) throw error;
      return NextResponse.json({ success: true });
    }
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
    const name = cleanTemplateName(request.nextUrl.searchParams.get('name'));
    const del = await supabaseServer.from('listing_template_steps').delete().eq('tc_user_id', user.id).eq('template_name', name);
    if (del.error && name === DEFAULT_TEMPLATE_NAME) await supabaseServer.from('listing_template_steps').delete().eq('tc_user_id', user.id);
    return NextResponse.json({ success: true, steps: DEFAULT_LISTING_STEPS });
  } catch (error) {
    return fail(error, 'reset');
  }
}
