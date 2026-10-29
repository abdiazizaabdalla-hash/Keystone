import { NextRequest } from 'next/server';
import { after } from 'next/server';
import { supabaseServer } from './supabase';
import { getUserFromRequest, AuthError } from './auth';
import { isAgentUser, assertAgentOnTransaction } from './agentPortal';
import { queueDealNotification } from './notifications';
import { sendClientMessageEmail, sendNewMessageEmail } from './agentPortalEmails';

// Client messaging. Three places a message can live (see
// add-client-messages.sql): the shared 'board' that every client, the agent
// and the TC can read, and two private threads per client -- 'agent' (client
// and agent only; the TC cannot see it) and 'tc' (client and TC only; the
// agent cannot see it). The client is not a signed-in user: their progress
// link token is their identity (api/external/[token]/messages).

export type StaffRole = 'agent' | 'tc';
export type DbChannel = 'board' | 'agent' | 'tc';

export const MAX_MESSAGE_LENGTH = 4000;
const EMAIL_THROTTLE_MS = 10 * 60 * 1000;

export interface StaffContext {
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> };
  role: StaffRole;
  label: string;
}

/** Who may read and post on a deal's client messages: an agent who accepted the deal, or the TC who owns it (or an admin). */
export async function loadStaffContext(request: NextRequest, transactionId: string): Promise<StaffContext> {
  const { user, isAdmin } = await getUserFromRequest(request);
  const role: StaffRole = isAgentUser(user) ? 'agent' : 'tc';
  const meta = (user as { user_metadata?: Record<string, unknown> }).user_metadata;

  if (role === 'agent') {
    await assertAgentOnTransaction(transactionId, user.id);
  } else if (!isAdmin) {
    const { data: transaction } = await supabaseServer.from('transactions').select('agent_id').eq('id', transactionId).single();
    if (!transaction) throw new AuthError('Transaction not found', 404);
    const { data: agent } = await supabaseServer
      .from('agents')
      .select('id')
      .eq('id', transaction.agent_id)
      .eq('tc_user_id', user.id)
      .single();
    if (!agent) throw new AuthError('You do not have permission to message on this transaction', 403);
  }

  const fullName = typeof meta?.full_name === 'string' ? meta.full_name.trim() : '';
  return {
    user: { id: user.id, email: user.email, user_metadata: meta },
    role,
    label: fullName || (role === 'agent' ? 'Your agent' : 'Your TC'),
  };
}

export interface ActiveClient {
  id: string;
  name: string;
  email: string | null;
  token: string;
}

/** The deal's clients: progress links that are neither turned off nor expired. */
export async function listActiveClients(transactionId: string): Promise<ActiveClient[]> {
  const { data } = await supabaseServer
    .from('external_access_links')
    .select('id, client_name, client_email, token, created_at')
    .eq('transaction_id', transactionId)
    .eq('scope', 'progress')
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true });
  return (data || []).map((l) => ({
    id: l.id as string,
    name: (l.client_name as string) || (l.client_email as string) || 'Client',
    email: (l.client_email as string | null) ?? null,
    token: l.token as string,
  }));
}

export interface ClientMessageRow {
  id: string;
  link_id: string | null;
  channel: DbChannel;
  sender_type: 'client' | 'agent' | 'tc';
  sender_name: string | null;
  body: string;
  created_at: string;
}

const MESSAGE_COLUMNS = 'id, link_id, channel, sender_type, sender_name, body, created_at';

export async function fetchBoard(transactionId: string): Promise<ClientMessageRow[]> {
  const { data } = await supabaseServer
    .from('client_messages')
    .select(MESSAGE_COLUMNS)
    .eq('transaction_id', transactionId)
    .eq('channel', 'board')
    .order('created_at', { ascending: true })
    .limit(500);
  return (data || []) as ClientMessageRow[];
}

export async function fetchPrivate(transactionId: string, linkId: string, channel: 'agent' | 'tc'): Promise<ClientMessageRow[]> {
  const { data } = await supabaseServer
    .from('client_messages')
    .select(MESSAGE_COLUMNS)
    .eq('transaction_id', transactionId)
    .eq('link_id', linkId)
    .eq('channel', channel)
    .order('created_at', { ascending: true })
    .limit(500);
  return (data || []) as ClientMessageRow[];
}

async function getParties(transactionId: string) {
  const { data: transaction } = await supabaseServer
    .from('transactions')
    .select('agent_id, property_address')
    .eq('id', transactionId)
    .maybeSingle();
  let tcEmail: string | null = null;
  if (transaction?.agent_id) {
    const { data: agentRecord } = await supabaseServer.from('agents').select('tc_user_id').eq('id', transaction.agent_id).maybeSingle();
    if (agentRecord?.tc_user_id) {
      const { data } = await supabaseServer.auth.admin.getUserById(agentRecord.tc_user_id as string);
      tcEmail = data.user?.email ?? null;
    }
  }
  const { data: grants } = await supabaseServer.from('transaction_agents').select('agent_user_id').eq('transaction_id', transactionId);
  const agentEmails = (
    await Promise.all(
      (grants || []).map(async (g) => {
        const { data } = await supabaseServer.auth.admin.getUserById(g.agent_user_id as string);
        return data.user?.email ?? null;
      })
    )
  ).filter((e): e is string => Boolean(e));
  return { address: (transaction?.property_address as string | null) ?? null, tcEmail, agentEmails };
}

function runAfter(task: () => Promise<void>) {
  const safe = () => task().catch((err) => console.error('Client message side effect failed:', err));
  try {
    after(safe);
  } catch {
    // outside a request; skip
  }
}

async function recentlySent(match: Record<string, string | null>, transactionId: string): Promise<boolean> {
  let q = supabaseServer
    .from('client_messages')
    .select('created_at')
    .eq('transaction_id', transactionId)
    .gte('created_at', new Date(Date.now() - EMAIL_THROTTLE_MS).toISOString());
  for (const [k, v] of Object.entries(match)) q = v === null ? q.is(k, null) : q.eq(k, v);
  // The message that triggered this call is already stored, so a second one in the window means a burst.
  const { data } = await q.limit(2);
  return (data || []).length > 1;
}

/** After the agent or TC posts: bell the other staff side (board only) and email the client(s). */
export function afterStaffMessage(params: {
  request: NextRequest;
  ctx: StaffContext;
  transactionId: string;
  channel: DbChannel;
  linkId: string | null;
  body: string;
}) {
  const { request, ctx, transactionId, channel, linkId, body } = params;
  const origin = request.nextUrl.origin;

  if (channel === 'board') {
    queueDealNotification({
      transactionId,
      actorUserId: ctx.user.id,
      type: 'message',
      title: 'New board message',
      body,
      audience: ctx.role === 'agent' ? 'tc' : 'agents',
      coalesce: { title: (n) => `${n} new board messages` },
    });
  }

  runAfter(async () => {
    const throttled = await recentlySent({ channel, sender_user_id: ctx.user.id, link_id: channel === 'board' ? null : linkId }, transactionId);
    if (throttled) return;
    const { address } = await getParties(transactionId);
    const clients = await listActiveClients(transactionId);
    const targets = channel === 'board' ? clients : clients.filter((c) => c.id === linkId);
    await Promise.all(
      targets
        .filter((c) => c.email)
        .map((c) =>
          sendClientMessageEmail({
            toEmail: c.email as string,
            clientName: c.name,
            senderLabel: ctx.label,
            senderEmail: ctx.user.email || null,
            propertyAddress: address,
            preview: body,
            linkUrl: `${origin}/external/${c.token}`,
            isPrivate: channel !== 'board',
          }).catch((err) => console.error('Error emailing client:', err))
        )
    );
  });
}

/** After a client posts: bell and email whoever can see that thread. */
export function afterClientMessage(params: {
  origin: string;
  transactionId: string;
  channel: DbChannel;
  linkId: string;
  clientName: string;
  body: string;
}) {
  const { origin, transactionId, channel, linkId, clientName, body } = params;
  const audience = channel === 'board' ? 'all' : channel === 'agent' ? 'agents' : 'tc';

  queueDealNotification({
    transactionId,
    actorUserId: null,
    type: 'message',
    title: channel === 'board' ? `${clientName} posted on the board` : `${clientName} sent you a private message`,
    body,
    audience,
    coalesce: { title: (n) => `${n} new client messages` },
  });

  runAfter(async () => {
    const throttled = await recentlySent({ channel, sender_type: 'client', link_id: linkId }, transactionId);
    if (throttled) return;
    const { address, tcEmail, agentEmails } = await getParties(transactionId);
    const emails = [...(audience !== 'agents' && tcEmail ? [tcEmail] : []), ...(audience !== 'tc' ? agentEmails : [])];
    await Promise.all(
      [...new Set(emails)].map((toEmail) =>
        sendNewMessageEmail({
          toEmail,
          senderLabel: `${clientName} (client)`,
          propertyAddress: address,
          preview: body,
          portalUrl: agentEmails.includes(toEmail) ? `${origin}/agent/transactions/${transactionId}` : `${origin}/dashboard/transactions/${transactionId}`,
        }).catch((err) => console.error('Error emailing staff about client message:', err))
      )
    );
  });
}
