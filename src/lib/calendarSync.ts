import { supabaseServer } from './supabase';
import { decryptSecret } from './encryption';
import {
  refreshAccessToken,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  CalendarEventNotFoundError,
} from './googleCalendar';

interface SyncableTask {
  id: string;
  name: string;
  due_date: string | null;
  completed: boolean;
  google_event_id?: string | null;
}

/**
 * Syncs one transaction's tasks to the TC's connected Google Calendar, if
 * they have one connected. Best-effort and fully non-fatal: no connection,
 * a Google API error, or a revoked/expired grant are all caught and
 * logged here, never thrown -- calendar sync is a feature layered on top
 * of the checklist/due-date system, and must never block creating a
 * transaction, toggling a task, or editing a due date just because
 * Calendar is unreachable or disconnected.
 *
 * Per task: a due_date on an incomplete task gets an event created (or
 * updated, if one already exists for it). Anything else -- no due_date,
 * or the task is completed -- gets its event deleted if one exists.
 * `tasks[].google_event_id` is written back to the `tasks` table
 * whenever it changes, so later syncs update the same event instead of
 * creating duplicates.
 */
export async function syncTransactionTasksToCalendar(
  tcUserId: string,
  transactionLabel: string,
  tasks: SyncableTask[]
): Promise<void> {
  try {
    const { data: connection } = await supabaseServer
      .from('calendar_connections')
      .select('refresh_token')
      .eq('tc_user_id', tcUserId)
      .eq('provider', 'google')
      .maybeSingle();

    if (!connection) return; // Not connected -- nothing to do.

    const { accessToken } = await refreshAccessToken(decryptSecret(connection.refresh_token));

    for (const task of tasks) {
      await syncOneTask(accessToken, transactionLabel, task);
    }
  } catch (error) {
    console.error('Calendar sync failed (non-fatal):', error);
  }
}

async function syncOneTask(accessToken: string, transactionLabel: string, task: SyncableTask): Promise<void> {
  const shouldHaveEvent = Boolean(task.due_date) && !task.completed;

  if (!shouldHaveEvent) {
    if (task.google_event_id) {
      try {
        await deleteCalendarEvent(accessToken, task.google_event_id);
      } catch (error) {
        console.error(`Failed to delete calendar event for task ${task.id} (non-fatal):`, error);
      }
      await supabaseServer.from('tasks').update({ google_event_id: null }).eq('id', task.id);
    }
    return;
  }

  const eventInput = {
    summary: `${task.name} — ${transactionLabel}`,
    description: `Relay TC checklist task for ${transactionLabel}.`,
    dueDate: task.due_date as string,
  };

  try {
    if (task.google_event_id) {
      try {
        await updateCalendarEvent(accessToken, task.google_event_id, eventInput);
        return;
      } catch (error) {
        if (!(error instanceof CalendarEventNotFoundError)) throw error;
        // Google no longer has it -- fall through and create a fresh one.
      }
    }

    const eventId = await createCalendarEvent(accessToken, eventInput);
    await supabaseServer.from('tasks').update({ google_event_id: eventId }).eq('id', task.id);
  } catch (error) {
    console.error(`Failed to sync calendar event for task ${task.id} (non-fatal):`, error);
  }
}
