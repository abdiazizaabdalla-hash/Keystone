import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { mergeUserMetadata } from '@/lib/userMetadata';
import { getMutedTypes, isNotificationType } from '@/lib/notifications';

// The notification bell's backend. Works for both TCs and agents -- every
// row is scoped to the caller's own user id, so there is nothing else to
// authorize.

const PAGE_SIZE = 25;
// Read rows older than this are cleaned up opportunistically on read, so
// the table doesn't grow forever.
const READ_RETENTION_DAYS = 45;

// GET /api/notifications -- newest first, plus the unread count and the
// event types this person has muted.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const [{ data: rows, error }, { count }, muted] = await Promise.all([
      supabaseServer
        .from('notifications')
        .select('id, event_type, title, body, link, event_count, read_at, created_at, transaction_id')
        .eq('recipient_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE),
      supabaseServer
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_user_id', user.id)
        .is('read_at', null),
      getMutedTypes(user.id),
    ]);
    if (error) throw error;

    // Best-effort tidy-up of old, already-read rows.
    const cutoff = new Date(Date.now() - READ_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    supabaseServer
      .from('notifications')
      .delete()
      .eq('recipient_user_id', user.id)
      .not('read_at', 'is', null)
      .lt('created_at', cutoff)
      .then(() => undefined, () => undefined);

    return NextResponse.json({ notifications: rows || [], unreadCount: count || 0, muted });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching notifications:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}

// PATCH /api/notifications
//   { markAllRead: true }          -- mark everything read
//   { ids: ['...'] }               -- mark those rows read
//   { muted: ['message', ...] }    -- save which event types to stop receiving
export async function PATCH(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const body = await request.json().catch(() => ({}));
    const now = new Date().toISOString();

    if (body.markAllRead === true) {
      const { error } = await supabaseServer
        .from('notifications')
        .update({ read_at: now })
        .eq('recipient_user_id', user.id)
        .is('read_at', null);
      if (error) throw error;
    }

    if (Array.isArray(body.ids)) {
      const ids = body.ids.filter((id: unknown): id is string => typeof id === 'string').slice(0, 100);
      if (ids.length > 0) {
        const { error } = await supabaseServer
          .from('notifications')
          .update({ read_at: now })
          .eq('recipient_user_id', user.id)
          .in('id', ids)
          .is('read_at', null);
        if (error) throw error;
      }
    }

    if (Array.isArray(body.muted)) {
      const muted = [...new Set(body.muted.filter(isNotificationType))];
      await mergeUserMetadata(user.id, { notification_muted: muted });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating notifications:', error);
    return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
  }
}
