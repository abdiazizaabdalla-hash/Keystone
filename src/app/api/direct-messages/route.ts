import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { checkRateLimit } from '@/lib/rateLimit';
import { sendDirectMessageEmail } from '@/lib/agentPortalEmails';
import { DIRECT_MESSAGE_MAX, agentsForTc, normEmail, tcIdsForAgent, userLabel, type DirectMessageRow } from '@/lib/directMessages';

// General messages between a coordinator and an agent. Deal messages and listing messages live inside
// their deals and listings and are not shown here.
//
//   GET                -> { conversations: [{ key, label, subLabel, lastMessage }] }  (everyone this person may message)
//   GET ?with=<key>    -> { label, messages }   key = the agent's email (coordinator side) or the coordinator's id (agent side)
//   POST { with, body } -> the new message
//
// Coordinators are owner-only (the same rule as deal messages): you only ever see conversations that belong to you.

const EMAIL_THROTTLE_MS = 10 * 60 * 1000;

type Side = { role: 'tc'; tcUserId: string } | { role: 'agent'; agentEmail: string; agentUserId: string };

async function resolveCounterpart(side: Side, key: string): Promise<{ tcUserId: string; agentEmail: string; label: string } | null> {
  if (side.role === 'tc') {
    const email = normEmail(key);
    const allowed = await agentsForTc(side.tcUserId);
    if (!allowed.has(email)) return null;
    return { tcUserId: side.tcUserId, agentEmail: email, label: allowed.get(email) || email };
  }
  const allowed = await tcIdsForAgent(side.agentUserId, side.agentEmail);
  if (!allowed.includes(key)) return null;
  return { tcUserId: key, agentEmail: side.agentEmail, label: (await userLabel(key)).label };
}

async function whoAmI(request: NextRequest): Promise<{ user: Awaited<ReturnType<typeof getUserFromRequest>>['user']; side: Side }> {
  const { user } = await getUserFromRequest(request);
  if (isAgentUser(user)) {
    const email = normEmail(user.email);
    if (!email) throw new AuthError('Your account has no email address', 400);
    return { user, side: { role: 'agent', agentEmail: email, agentUserId: user.id } };
  }
  return { user, side: { role: 'tc', tcUserId: user.id } };
}

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} direct messages:`, error);
  return NextResponse.json({ error: `Failed to ${what} messages` }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const { side } = await whoAmI(request);
    const key = request.nextUrl.searchParams.get('with');

    if (key) {
      const who = await resolveCounterpart(side, key);
      if (!who) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      const { data } = await supabaseServer
        .from('direct_messages')
        .select('id, sender_role, body, created_at')
        .eq('tc_user_id', who.tcUserId)
        .eq('agent_email', who.agentEmail)
        .order('created_at', { ascending: true })
        .limit(500);
      return NextResponse.json({ label: who.label, messages: data || [] });
    }

    // The list: everyone this person may message, those with messages first (newest on top).
    let people: { key: string; label: string; subLabel: string | null; tcUserId: string; agentEmail: string }[];
    if (side.role === 'tc') {
      const agents = await agentsForTc(side.tcUserId);
      people = [...agents.entries()].map(([email, name]) => ({ key: email, label: name, subLabel: name === email ? null : email, tcUserId: side.tcUserId, agentEmail: email }));
    } else {
      const ids = await tcIdsForAgent(side.agentUserId, side.agentEmail);
      people = await Promise.all(ids.map(async (id) => ({ key: id, label: (await userLabel(id)).label, subLabel: null, tcUserId: id, agentEmail: side.agentEmail })));
    }

    const filterCol = side.role === 'tc' ? 'tc_user_id' : 'agent_email';
    const filterVal = side.role === 'tc' ? side.tcUserId : side.agentEmail;
    const { data: recent } = await supabaseServer
      .from('direct_messages')
      .select('tc_user_id, agent_email, sender_role, body, created_at')
      .eq(filterCol, filterVal)
      .order('created_at', { ascending: false })
      .limit(1000);
    const last = new Map<string, { senderRole: string; body: string; createdAt: string }>();
    for (const m of (recent || []) as Pick<DirectMessageRow, 'tc_user_id' | 'agent_email' | 'sender_role' | 'body' | 'created_at'>[]) {
      const k = side.role === 'tc' ? m.agent_email : m.tc_user_id;
      if (!last.has(k)) last.set(k, { senderRole: m.sender_role, body: m.body, createdAt: m.created_at });
    }

    const conversations = people
      .map((p) => ({ key: p.key, label: p.label, subLabel: p.subLabel, lastMessage: last.get(p.key) || null }))
      .sort((a, b) => {
        const at = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : -1;
        const bt = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : -1;
        return bt - at || a.label.localeCompare(b.label);
      });
    return NextResponse.json({ conversations });
  } catch (error) {
    return fail(error, 'load');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, side } = await whoAmI(request);
    await assertTrialActive(user);
    if (!(await checkRateLimit(`direct-message:${user.id}`, 60, 60 * 60))) {
      return NextResponse.json({ error: 'You have sent a lot of messages. Try again a bit later.' }, { status: 429 });
    }
    const input = await request.json().catch(() => ({}));
    const key = typeof input.with === 'string' ? input.with : '';
    const text = typeof input.body === 'string' ? input.body.trim() : '';
    if (!key) return NextResponse.json({ error: 'Choose who to message' }, { status: 400 });
    if (!text) return NextResponse.json({ error: 'Message body is required' }, { status: 400 });
    if (text.length > DIRECT_MESSAGE_MAX) return NextResponse.json({ error: `Message is too long (${DIRECT_MESSAGE_MAX} characters max)` }, { status: 400 });

    const who = await resolveCounterpart(side, key);
    if (!who) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

    // Was the previous message from this same person recent? Then skip the email, so a quick back-and-forth is not a flood.
    const { data: prev } = await supabaseServer
      .from('direct_messages')
      .select('sender_role, created_at')
      .eq('tc_user_id', who.tcUserId)
      .eq('agent_email', who.agentEmail)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: message, error } = await supabaseServer
      .from('direct_messages')
      .insert({ tc_user_id: who.tcUserId, agent_email: who.agentEmail, sender_id: user.id, sender_role: side.role, body: text })
      .select('id, sender_role, body, created_at')
      .single();
    if (error) throw error;

    const justSent = prev?.[0] && prev[0].sender_role === side.role && Date.now() - new Date(prev[0].created_at as string).getTime() < EMAIL_THROTTLE_MS;
    if (!justSent) {
      (async () => {
        const senderLabel = (user.user_metadata?.full_name as string | undefined)?.trim() || user.email || (side.role === 'tc' ? 'Your coordinator' : 'Your agent');
        const toEmail = side.role === 'tc' ? who.agentEmail : (await userLabel(who.tcUserId)).email;
        if (!toEmail) return;
        await sendDirectMessageEmail({
          toEmail,
          senderLabel,
          preview: text,
          portalUrl: `${request.nextUrl.origin}${side.role === 'tc' ? '/agent/messages' : '/dashboard/messages'}`,
        });
      })().catch((e) => console.error('Error sending direct-message email:', e));
    }

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    return fail(error, 'send');
  }
}
