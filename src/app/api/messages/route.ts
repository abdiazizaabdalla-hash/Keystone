import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser, assertAgentOnTransaction } from '@/lib/agentPortal';
import { sendNewMessageEmail } from '@/lib/agentPortalEmails';

// Confirms the caller may read/post in this transaction's thread. Kept
// owner-only for the TC side (not widened to the whole Team the way
// document/task reads are, via getVisibleTcUserIds) -- messaging is a
// direct conversation between the TC who owns the deal and the agent(s)
// on it, not something every teammate should be dropped into. Agents are
// scoped the normal way, via transaction_agents.
async function assertCanMessage(transactionId: string, userId: string, isAdmin: boolean, isAgent: boolean) {
  if (isAgent) {
    await assertAgentOnTransaction(transactionId, userId);
    return;
  }
  if (isAdmin) return;

  const { data: transaction, error } = await supabaseServer
    .from('transactions')
    .select('agent_id')
    .eq('id', transactionId)
    .single();
  if (error || !transaction) {
    throw new AuthError('Transaction not found', 404);
  }
  const { data: agent } = await supabaseServer
    .from('agents')
    .select('id')
    .eq('id', transaction.agent_id)
    .eq('tc_user_id', userId)
    .single();
  if (!agent) {
    throw new AuthError('You do not have permission to message on this transaction', 403);
  }
}

const ATTACHMENT_BUCKET = 'transaction-documents';
const ATTACHMENT_URL_TTL_SECONDS = 60 * 60; // 1 hour, same as /api/documents

export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const transactionId = request.nextUrl.searchParams.get('transactionId');
    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    const callerIsAgent = isAgentUser(user);
    await assertCanMessage(transactionId, user.id, isAdmin, callerIsAgent);

    const { data: messages, error } = await supabaseServer
      .from('messages')
      .select('id, sender_id, sender_role, body, created_at, attachment_document_id')
      .eq('transaction_id', transactionId)
      .order('created_at', { ascending: true });
    if (error) throw error;

    // Attach a short-lived signed URL for any message that carries a
    // file, same as /api/documents does for the Documents tab -- keeps
    // the private storage bucket usable straight from a chat bubble
    // without a second round-trip per message.
    const attachmentIds = [...new Set((messages || []).map((m) => m.attachment_document_id).filter(Boolean))];
    const attachmentsById = new Map<
      string,
      { id: string; fileName: string; url: string | null; contentType: string | null; fileSize: number | null }
    >();
    if (attachmentIds.length > 0) {
      const { data: docs } = await supabaseServer
        .from('documents')
        .select('id, file_name, storage_path, content_type, file_size')
        .in('id', attachmentIds as string[]);
      await Promise.all(
        (docs || []).map(async (doc) => {
          const { data: signed } = await supabaseServer.storage
            .from(ATTACHMENT_BUCKET)
            .createSignedUrl(doc.storage_path, ATTACHMENT_URL_TTL_SECONDS);
          attachmentsById.set(doc.id, {
            id: doc.id,
            fileName: doc.file_name,
            url: signed?.signedUrl || null,
            contentType: doc.content_type,
            fileSize: doc.file_size,
          });
        })
      );
    }

    const withAttachments = (messages || []).map((m) => ({
      ...m,
      attachment: m.attachment_document_id ? attachmentsById.get(m.attachment_document_id) || null : null,
    }));

    return NextResponse.json(withAttachments);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching messages:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const body = await request.json();
    const transactionId = typeof body.transactionId === 'string' ? body.transactionId : '';
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    const attachmentDocumentId =
      typeof body.attachmentDocumentId === 'string' && body.attachmentDocumentId ? body.attachmentDocumentId : null;

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }
    // A message needs text, an attachment, or both -- not neither.
    if (!text && !attachmentDocumentId) {
      return NextResponse.json({ error: 'Message body is required' }, { status: 400 });
    }
    if (text.length > 4000) {
      return NextResponse.json({ error: 'Message is too long (4000 characters max)' }, { status: 400 });
    }

    const callerIsAgent = isAgentUser(user);
    await assertCanMessage(transactionId, user.id, isAdmin, callerIsAgent);

    // Confirm the attached document is actually already on this same
    // transaction -- it was uploaded through POST /api/documents first
    // (see the composer), so this just guards against someone pointing a
    // message at a document from a transaction they have no business
    // referencing.
    if (attachmentDocumentId) {
      const { data: doc, error: docError } = await supabaseServer
        .from('documents')
        .select('id')
        .eq('id', attachmentDocumentId)
        .eq('transaction_id', transactionId)
        .maybeSingle();
      if (docError) throw docError;
      if (!doc) {
        return NextResponse.json({ error: 'Attachment not found on this transaction' }, { status: 400 });
      }
    }

    const { data: message, error } = await supabaseServer
      .from('messages')
      .insert({
        transaction_id: transactionId,
        sender_id: user.id,
        sender_role: callerIsAgent ? 'agent' : 'tc',
        body: text,
        attachment_document_id: attachmentDocumentId,
      })
      .select()
      .single();
    if (error) throw error;

    // Notify whichever side didn't send this -- non-fatal, same as every
    // other notification email in this codebase. Throttled inside
    // notifyOtherParty so a fast back-and-forth doesn't send one email
    // per message.
    notifyOtherParty(transactionId, user, callerIsAgent, text || 'Sent a file', request.nextUrl.origin, message.id).catch(
      (emailError) => {
        console.error('Error sending new-message email:', emailError);
      }
    );

    // Enrich with the same signed-URL attachment shape GET returns, so
    // the sender's own optimistic UI update has a working link
    // immediately instead of waiting on the next poll.
    let attachment = null;
    if (attachmentDocumentId) {
      const { data: doc } = await supabaseServer
        .from('documents')
        .select('id, file_name, storage_path, content_type, file_size')
        .eq('id', attachmentDocumentId)
        .maybeSingle();
      if (doc) {
        const { data: signed } = await supabaseServer.storage
          .from(ATTACHMENT_BUCKET)
          .createSignedUrl(doc.storage_path, ATTACHMENT_URL_TTL_SECONDS);
        attachment = {
          id: doc.id,
          fileName: doc.file_name,
          url: signed?.signedUrl || null,
          contentType: doc.content_type,
          fileSize: doc.file_size,
        };
      }
    }

    return NextResponse.json({ ...message, attachment }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error posting message:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}

// Internal, TC/admin-only fix-up for a message that was seeded or sent
// with the wrong sender_role (e.g. during demo data setup). This is NOT
// a general "edit message" feature -- there's no UI control that calls
// it, and it's deliberately off-limits to agents. Hiding a message from
// view (see hideMessage/unhideMessage client-side) is the normal,
// per-browser "not unsend" tool; this endpoint is for correcting the
// underlying data once, server-side, so the fix shows up everywhere.
export async function PATCH(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    if (isAgentUser(user)) {
      return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
    }

    const body = await request.json();
    const messageId = typeof body.id === 'string' ? body.id : '';
    const senderRole = body.senderRole;
    if (!messageId || (senderRole !== 'tc' && senderRole !== 'agent')) {
      return NextResponse.json({ error: 'id and senderRole ("tc" | "agent") are required' }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await supabaseServer
      .from('messages')
      .select('id, transaction_id')
      .eq('id', messageId)
      .single();
    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Same ownership check as assertCanMessage's TC branch -- the caller
    // must own the transaction (or be an admin), never just any TC.
    await assertCanMessage(existing.transaction_id, user.id, isAdmin, false);

    const { data: updated, error: updateError } = await supabaseServer
      .from('messages')
      .update({ sender_role: senderRole })
      .eq('id', messageId)
      .select()
      .single();
    if (updateError) throw updateError;

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error patching message:', error);
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 });
  }
}

// How long to stay quiet after this same sender's last message in this
// thread before sending another notification email -- a fast
// back-and-forth ("hows it going" / "great!" / ...) shouldn't fire one
// email per line; it rides on whichever email already went out (or is
// about to) for an earlier message in that burst.
const NOTIFICATION_THROTTLE_MS = 10 * 60 * 1000;

async function notifyOtherParty(
  transactionId: string,
  sender: { id: string; email?: string; user_metadata?: { full_name?: string } | null },
  senderIsAgent: boolean,
  text: string,
  appUrl: string,
  newMessageId: string
) {
  const { data: transaction } = await supabaseServer
    .from('transactions')
    .select('agent_id, property_address')
    .eq('id', transactionId)
    .single();
  if (!transaction) return;

  const { data: priorMessage } = await supabaseServer
    .from('messages')
    .select('created_at')
    .eq('transaction_id', transactionId)
    .eq('sender_role', senderIsAgent ? 'agent' : 'tc')
    .neq('id', newMessageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorMessage && Date.now() - new Date(priorMessage.created_at).getTime() < NOTIFICATION_THROTTLE_MS) {
    return;
  }

  const senderLabel = sender.user_metadata?.full_name || sender.email || (senderIsAgent ? 'The agent' : 'Your TC');
  const portalUrl = senderIsAgent
    ? `${appUrl}/dashboard/transactions/${transactionId}`
    : `${appUrl}/agent/transactions/${transactionId}`;

  let recipients: string[] = [];
  if (senderIsAgent) {
    // Agent sent it -- notify the TC.
    const { data: agentRecord } = await supabaseServer
      .from('agents')
      .select('tc_user_id')
      .eq('id', transaction.agent_id)
      .maybeSingle();
    if (agentRecord?.tc_user_id) {
      const { data } = await supabaseServer.auth.admin.getUserById(agentRecord.tc_user_id);
      if (data.user?.email) recipients = [data.user.email];
    }
  } else {
    // TC sent it -- notify every agent who's accepted access to this deal.
    const { data: grants } = await supabaseServer
      .from('transaction_agents')
      .select('agent_user_id')
      .eq('transaction_id', transactionId);
    recipients = (
      await Promise.all(
        (grants || []).map(async (g) => {
          const { data } = await supabaseServer.auth.admin.getUserById(g.agent_user_id);
          return data.user?.email || null;
        })
      )
    ).filter((email): email is string => Boolean(email));
  }

  await Promise.all(
    recipients.map((toEmail) =>
      sendNewMessageEmail({
        toEmail,
        senderLabel,
        propertyAddress: transaction.property_address || null,
        preview: text,
        portalUrl,
      })
    )
  );
}
