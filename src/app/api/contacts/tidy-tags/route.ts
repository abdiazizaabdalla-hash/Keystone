import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { tidyTags } from '@/lib/contactCategories';

// Groups role-style tags ("seller's preferred inspector", "title contact (escrow officer)") into
// broad categories (Inspector, Title...). Tags the user typed themselves are never changed, and the
// contact's role stays exactly as it was.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    await assertTrialActive(user);

    const { data, error } = await supabaseServer.from('contacts').select('id, role, tags').eq('tc_user_id', user.id).limit(5000);
    if (error) throw error;

    let changed = 0;
    for (const c of data || []) {
      const current = (c.tags as string[] | null) || [];
      const next = tidyTags(c.role as string | null, current);
      if (next === current) continue;
      const { error: uErr } = await supabaseServer
        .from('contacts')
        .update({ tags: next.slice(0, 15), updated_at: new Date().toISOString() })
        .eq('id', c.id)
        .eq('tc_user_id', user.id);
      if (uErr) throw uErr;
      changed += 1;
    }
    return NextResponse.json({ changed });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error tidying contact tags:', error);
    return NextResponse.json({ error: 'Failed to tidy tags' }, { status: 500 });
  }
}
