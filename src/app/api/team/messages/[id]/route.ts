import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getMessagingContext, describeMessagingError, SETUP_MISSING_RESPONSE } from '@/lib/teamMessaging';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DELETE /api/team/messages/:id -- you can delete your own messages; the
// team owner can also remove anything on the shared board (not other
// people's private direct messages).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getUserFromRequest(request);
    const ctx = await getMessagingContext(user.id);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    const { data: message } = await supabaseServer
      .from('team_messages')
      .select('id, sender_id, recipient_id, team_id')
      .eq('id', id)
      .maybeSingle();
    if (!message || message.team_id !== ctx.teamId) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    const isSender = message.sender_id === user.id;
    const ownerMayModerate = ctx.isOwner && message.recipient_id === null;
    if (!isSender && !ownerMayModerate) {
      return NextResponse.json({ error: 'You can only delete your own messages.' }, { status: 403 });
    }

    const { error } = await supabaseServer.from('team_messages').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ status: 'deleted' });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (describeMessagingError('Error deleting team message:', error).setupMissing) {
      return NextResponse.json(SETUP_MISSING_RESPONSE, { status: 503 });
    }
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
  }
}
