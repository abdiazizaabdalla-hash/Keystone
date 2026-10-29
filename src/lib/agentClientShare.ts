import { NextRequest } from 'next/server';
import { supabaseServer } from './supabase';
import { getUserFromRequest, AuthError } from './auth';
import { isAgentUser, assertAgentOnTransaction } from './agentPortal';
import { sendClientProgressEmail } from './agentPortalEmails';

// Shared by the agent portal's client-sharing routes
// (api/agent/transactions/[id]/clients and .../[linkId]). Lives here
// rather than in a route file because Next only allows HTTP-method
// exports from a route.

export async function loadAgentContext(request: NextRequest, transactionId: string) {
  const { user } = await getUserFromRequest(request);
  if (!isAgentUser(user)) {
    throw new AuthError('This endpoint is for agent accounts only', 403);
  }
  await assertAgentOnTransaction(transactionId, user.id);
  return user;
}

export async function emailClientLink(
  request: NextRequest,
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> },
  transactionId: string,
  params: { clientName: string; clientEmail: string; note: string; token: string }
): Promise<boolean> {
  try {
    const { data: transaction } = await supabaseServer
      .from('transactions')
      .select('property_address, agent_id')
      .eq('id', transactionId)
      .single();
    const { data: agentRecord } = transaction?.agent_id
      ? await supabaseServer.from('agents').select('name').eq('id', transaction.agent_id).maybeSingle()
      : { data: null };
    const agentLabel =
      (user.user_metadata?.full_name as string | undefined) || (agentRecord?.name as string | undefined) || user.email || 'Your agent';

    await sendClientProgressEmail({
      toEmail: params.clientEmail,
      clientName: params.clientName || null,
      agentLabel,
      agentEmail: user.email || null,
      propertyAddress: (transaction?.property_address as string | null) ?? null,
      note: params.note || null,
      linkUrl: `${request.nextUrl.origin}/external/${params.token}`,
    });
    return true;
  } catch (err) {
    console.error('Error sending client progress email:', err);
    return false;
  }
}
