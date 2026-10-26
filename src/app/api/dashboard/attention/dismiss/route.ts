import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';

const MAX_KEY = 200;
const MAX_DISMISSED = 2000;
const KEEP_DAYS = 90;

const fail = (error: unknown, what: string) => {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`Error ${what} attention item:`, error);
  const missing = error && typeof error === 'object' && /attention_dismissals/.test(String((error as { message?: string }).message || ''));
  return NextResponse.json(
    { error: missing ? 'Dismissing needs one database update first (add-attention-dismissals.sql).' : `Failed to ${what} the item` },
    { status: 500 }
  );
};

const cleanKey = (v: unknown) => (typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_KEY ? v.trim() : null);

// Hide one item from this person's Needs Attention panel. The task itself is left exactly as it was.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const key = cleanKey(body.key);
    if (!key) return NextResponse.json({ error: 'Nothing to dismiss' }, { status: 400 });

    const { count } = await supabaseServer.from('attention_dismissals').select('item_key', { count: 'exact', head: true }).eq('tc_user_id', user.id);
    if ((count ?? 0) >= MAX_DISMISSED) return NextResponse.json({ error: 'Too many dismissed items. Restore some first.' }, { status: 400 });

    const { error } = await supabaseServer
      .from('attention_dismissals')
      .upsert({ tc_user_id: user.id, item_key: key, dismissed_at: new Date().toISOString() }, { onConflict: 'tc_user_id,item_key' });
    if (error) throw error;

    // Housekeeping: very old dismissals are forgotten so the list can't grow forever.
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
    await supabaseServer.from('attention_dismissals').delete().eq('tc_user_id', user.id).lt('dismissed_at', cutoff);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error, 'dismiss');
  }
}

// Bring one item back ({ key }) or everything this person dismissed ({ all: true }).
export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    let q = supabaseServer.from('attention_dismissals').delete().eq('tc_user_id', user.id);
    if (body.all === true) {
      // every row for this person
    } else {
      const key = cleanKey(body.key);
      if (!key) return NextResponse.json({ error: 'Nothing to restore' }, { status: 400 });
      q = q.eq('item_key', key);
    }
    const { error } = await q;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error, 'restore');
  }
}
