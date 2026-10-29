import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { loadAgentContext, emailClientLink as emailLink } from '@/lib/agentClientShare';

async function loadLink(transactionId: string, linkId: string) {
  const { data: link } = await supabaseServer
    .from('external_access_links')
    .select('id, token, client_name, client_email, client_note, revoked_at, expires_at')
    .eq('id', linkId)
    .eq('transaction_id', transactionId)
    .eq('scope', 'progress')
    .maybeSingle();
  if (!link) throw new AuthError('Link not found', 404);
  return link;
}

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`Error ${what}:`, error);
  return NextResponse.json({ error: `Failed to ${what}` }, { status: 500 });
}

// POST: email the client their link again.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  try {
    const { id: transactionId, linkId } = await params;
    const user = await loadAgentContext(request, transactionId);
    const link = await loadLink(transactionId, linkId);

    if (link.revoked_at || new Date(link.expires_at as string) < new Date()) {
      return NextResponse.json({ error: 'This link is no longer active.' }, { status: 400 });
    }
    if (!link.client_email) {
      return NextResponse.json({ error: 'This link has no email on it. Copy the link and send it yourself.' }, { status: 400 });
    }
    const allowed = await checkRateLimit(`agent-client-resend:${linkId}`, 5, 60 * 60);
    if (!allowed) {
      return NextResponse.json({ error: 'Already sent a few times in the last hour. Try again later.' }, { status: 429 });
    }

    const sent = await emailLink(request, user, transactionId, {
      clientName: (link.client_name as string) || '',
      clientEmail: link.client_email as string,
      note: (link.client_note as string) || '',
      token: link.token as string,
    });
    if (!sent) {
      return NextResponse.json({ error: 'The email could not be sent. Copy the link and send it yourself.' }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, 'resend link');
  }
}

// DELETE: revoke (the row stays, so the list still shows it was shared).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  try {
    const { id: transactionId, linkId } = await params;
    await loadAgentContext(request, transactionId);
    await loadLink(transactionId, linkId);
    const { error } = await supabaseServer
      .from('external_access_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', linkId)
      .eq('transaction_id', transactionId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, 'revoke link');
  }
}
