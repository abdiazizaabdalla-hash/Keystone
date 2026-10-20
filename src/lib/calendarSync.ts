import { after } from 'next/server';
import { supabaseServer } from './supabase';
import { decryptSecret } from './encryption';
import { getResendClient, INVOICE_FROM_EMAIL } from './resendClient';
import { escapeHtml } from './escapeHtml';
import {
  refreshAccessToken,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  CalendarEventNotFoundError,
  type CalendarEventInput,
} from './googleCalendar';

// Google Calendar sync for BOTH sides of a deal:
//   - the TC who owns the transaction: checklist task due dates (tasks.google_event_id)
//     plus the deal's critical dates;
//   - each agent on the deal (via the agent portal): the deal's critical dates only.
//
// Privacy contract (see /privacy "Google Calendar data"): Relay only ever
// creates, updates, and deletes events it made itself -- the event ids are
// recorded in `tasks.google_event_id` / `key_date_calendar_events`, and those
// are the ONLY events Relay ever touches. It never lists or reads the user's
// other events.
//
// Everything here is best-effort and non-fatal: a missing connection, a Google
// outage, or a revoked grant is logged and swallowed, never thrown into the
// request that triggered it (creating a deal, toggling a task, editing a date).

interface SyncableTask {
  id: string;
  name: string;
  due_date: string | null;
  completed: boolean;
  google_event_id?: string | null;
}

interface KeyDateRow {
  id: string;
  label: string;
  due_date: string;
  completed: boolean;
}

const todayIso = () => new Date().toISOString().split('T')[0];

/**
 * Returns a fresh access token for a connected user, or null when they have no
 * connection. A revoked/expired grant (Google answers `invalid_grant`) deletes
 * the dead connection row so the Settings card correctly shows "not connected".
 */
/** One email, sent when Google cancels a connection (the row is deleted right after, so this can't repeat). */
async function notifyCalendarDisconnected(userId: string): Promise<void> {
  try {
    const { data } = await supabaseServer.auth.admin.getUserById(userId);
    const email = data?.user?.email;
    if (!email) return;
    const isAgent = data.user?.app_metadata?.role === 'agent';
    const link = `https://www.relaytc.com/${isAgent ? 'agent' : 'dashboard'}/settings`;
    const name = escapeHtml(String((data.user?.user_metadata as { full_name?: string } | undefined)?.full_name || '').split(' ')[0] || 'there');
    await getResendClient().emails.send({
      from: INVOICE_FROM_EMAIL,
      to: [email],
      subject: 'Reconnect your Google Calendar in Relay TC',
      html:
        `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1f;">` +
        `<p>Hi ${name},</p>` +
        `<p>Google ended the connection between your calendar and Relay TC (this happens when access is revoked or expires), so new dates are no longer being added. Nothing was lost: the events already on your calendar are still there.</p>` +
        `<p><a href="${link}">Open Settings to reconnect</a> — it takes a few seconds.</p></div>`,
      text: `Google ended the connection between your calendar and Relay TC, so new dates are no longer being added. Reconnect in Settings: ${link}`,
    });
  } catch (error) {
    console.error('Calendar disconnect notice failed (ignored):', error);
  }
}

async function getAccessTokenFor(userId: string): Promise<string | null> {
  const { data: connection } = await supabaseServer
    .from('calendar_connections')
    .select('refresh_token')
    .eq('tc_user_id', userId) // column name is historical: it holds any Relay user id (TC or agent)
    .eq('provider', 'google')
    .maybeSingle();
  if (!connection) return null;

  try {
    const { accessToken } = await refreshAccessToken(decryptSecret(connection.refresh_token));
    return accessToken;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('invalid_grant')) {
      await supabaseServer.from('calendar_connections').delete().eq('tc_user_id', userId).eq('provider', 'google');
      await supabaseServer.from('key_date_calendar_events').delete().eq('user_id', userId);
      await notifyCalendarDisconnected(userId);
    }
    console.error('Calendar token refresh failed (non-fatal):', message);
    return null;
  }
}

/** Resolves the TC who owns a transaction (not always the requester -- admins and team members can act on it). */
async function getOwnerTcUserId(tx: { tc_user_id?: string | null; agent_id?: string | null }): Promise<string | null> {
  if (tx.tc_user_id) return tx.tc_user_id;
  if (!tx.agent_id) return null;
  const { data: agent } = await supabaseServer.from('agents').select('tc_user_id').eq('id', tx.agent_id).maybeSingle();
  return (agent?.tc_user_id as string | undefined) ?? null;
}

/**
 * Brings every connected calendar in line with a transaction: its owner TC (task
 * due dates + critical dates) and each agent on the deal (critical dates).
 * `onlyUserId` limits the work to one person -- used to back-fill right after
 * someone connects their calendar.
 */
export async function syncTransactionCalendar(transactionId: string, options: { onlyUserId?: string } = {}): Promise<void> {
  try {
    const { data: tx } = await supabaseServer
      .from('transactions')
      .select('id, file_number, property_address, agent_id, tc_user_id')
      .eq('id', transactionId)
      .maybeSingle();
    if (!tx) return;

    const label = `${tx.file_number} · ${tx.property_address}`;

    const [{ data: keyDates }, { data: agentLinks }, ownerId] = await Promise.all([
      supabaseServer
        .from('transaction_key_dates')
        .select('id, label, due_date, completed')
        .eq('transaction_id', transactionId),
      supabaseServer.from('transaction_agents').select('agent_user_id').eq('transaction_id', transactionId),
      getOwnerTcUserId(tx),
    ]);

    const dates = (keyDates || []) as KeyDateRow[];
    const { data: mappingRows } = dates.length
      ? await supabaseServer
          .from('key_date_calendar_events')
          .select('key_date_id, user_id, google_event_id')
          .in('key_date_id', dates.map((d) => d.id))
      : { data: [] as { key_date_id: string; user_id: string; google_event_id: string }[] };
    const mappings = mappingRows || [];

    const recipients = new Set<string>();
    if (ownerId) recipients.add(ownerId);
    for (const link of agentLinks || []) recipients.add(link.agent_user_id as string);
    if (options.onlyUserId) {
      if (!recipients.has(options.onlyUserId)) return;
      recipients.clear();
      recipients.add(options.onlyUserId);
    }

    for (const userId of recipients) {
      const accessToken = await getAccessTokenFor(userId);
      if (!accessToken) continue;

      await syncKeyDatesForUser(accessToken, userId, label, dates, mappings);
      // Best effort: the column comes from add-calendar-sync.sql; an error here (not run yet) is ignored.
      await supabaseServer
        .from('calendar_connections')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('tc_user_id', userId)
        .eq('provider', 'google');

      if (userId === ownerId) {
        const { data: tasks } = await supabaseServer
          .from('tasks')
          .select('id, name, due_date, completed, google_event_id')
          .eq('transaction_id', transactionId);
        for (const task of (tasks || []) as SyncableTask[]) {
          await syncOneTask(accessToken, label, task);
        }
      }
    }
  } catch (error) {
    console.error('Calendar sync failed (non-fatal):', error);
  }
}

/** Fire-and-forget version for request handlers: runs after the response has been sent, so a slow Google call never delays the user. */
export function queueCalendarSync(transactionId: string): void {
  try {
    after(() => syncTransactionCalendar(transactionId));
  } catch {
    // Outside a request scope (scripts/tests): just run it.
    void syncTransactionCalendar(transactionId);
  }
}

/** Back-fills one user's calendar across every deal they own (TC) or are on (agent). Runs right after they connect. */
export async function backfillUserCalendar(userId: string): Promise<void> {
  try {
    const ids = new Set<string>();
    const [{ data: owned }, { data: asAgent }] = await Promise.all([
      supabaseServer.from('transactions').select('id').eq('tc_user_id', userId).limit(300),
      supabaseServer.from('transaction_agents').select('transaction_id').eq('agent_user_id', userId).limit(300),
    ]);
    for (const row of owned || []) ids.add(row.id as string);
    for (const row of asAgent || []) ids.add(row.transaction_id as string);
    for (const id of ids) {
      await syncTransactionCalendar(id, { onlyUserId: userId });
    }
  } catch (error) {
    console.error('Calendar back-fill failed (non-fatal):', error);
  }
}

export function queueBackfillUserCalendar(userId: string): void {
  try {
    after(() => backfillUserCalendar(userId));
  } catch {
    void backfillUserCalendar(userId);
  }
}

async function syncKeyDatesForUser(
  accessToken: string,
  userId: string,
  label: string,
  dates: KeyDateRow[],
  mappings: { key_date_id: string; user_id: string; google_event_id: string }[]
): Promise<void> {
  const today = todayIso();
  for (const date of dates) {
    const existing = mappings.find((m) => m.key_date_id === date.id && m.user_id === userId);
    const isPast = date.due_date < today;

    // Completed dates lose their event. Dates already in the past that nobody has
    // completed are simply left alone (no new clutter, no deleting history).
    if (date.completed) {
      if (existing) await removeMappedEvent(accessToken, existing.key_date_id, userId, existing.google_event_id);
      continue;
    }
    if (isPast) continue;

    const input: CalendarEventInput = {
      summary: `${date.label} — ${label}`,
      description: `Critical date for ${label}, from Relay TC.`,
      dueDate: date.due_date,
    };

    try {
      if (existing) {
        try {
          await updateCalendarEvent(accessToken, existing.google_event_id, input);
          continue;
        } catch (error) {
          if (!(error instanceof CalendarEventNotFoundError)) throw error;
          // Google no longer has it (the user deleted it) -- recreate below.
        }
      }
      const eventId = await createCalendarEvent(accessToken, input);
      await supabaseServer
        .from('key_date_calendar_events')
        .upsert({ key_date_id: date.id, user_id: userId, google_event_id: eventId }, { onConflict: 'key_date_id,user_id' });
    } catch (error) {
      console.error(`Failed to sync key date ${date.id} for user ${userId} (non-fatal):`, error);
    }
  }
}

async function removeMappedEvent(accessToken: string, keyDateId: string, userId: string, eventId: string): Promise<void> {
  try {
    await deleteCalendarEvent(accessToken, eventId);
  } catch (error) {
    console.error(`Failed to delete calendar event ${eventId} (non-fatal):`, error);
  }
  await supabaseServer.from('key_date_calendar_events').delete().eq('key_date_id', keyDateId).eq('user_id', userId);
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

  const eventInput: CalendarEventInput = {
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
      }
    }
    const eventId = await createCalendarEvent(accessToken, eventInput);
    await supabaseServer.from('tasks').update({ google_event_id: eventId }).eq('id', task.id);
  } catch (error) {
    console.error(`Failed to sync calendar event for task ${task.id} (non-fatal):`, error);
  }
}

/**
 * Deletes the Google events for ONE critical date from every connected calendar.
 * Call this BEFORE deleting the key-date row (the mapping rows cascade away with it).
 */
export async function removeKeyDateCalendarEvents(keyDateId: string): Promise<void> {
  try {
    const { data: rows } = await supabaseServer
      .from('key_date_calendar_events')
      .select('user_id, google_event_id')
      .eq('key_date_id', keyDateId);
    for (const row of rows || []) {
      const accessToken = await getAccessTokenFor(row.user_id as string);
      if (accessToken) {
        await removeMappedEvent(accessToken, keyDateId, row.user_id as string, row.google_event_id as string);
      }
    }
  } catch (error) {
    console.error('Failed to remove key date calendar events (non-fatal):', error);
  }
}

/** Deletes every Google event for a transaction (task + critical-date events). Call BEFORE deleting the transaction. */
export async function removeTransactionCalendarEvents(transactionId: string): Promise<void> {
  try {
    const { data: tx } = await supabaseServer
      .from('transactions')
      .select('agent_id, tc_user_id')
      .eq('id', transactionId)
      .maybeSingle();

    const { data: dates } = await supabaseServer.from('transaction_key_dates').select('id').eq('transaction_id', transactionId);
    for (const d of dates || []) await removeKeyDateCalendarEvents(d.id as string);

    const ownerId = tx ? await getOwnerTcUserId(tx) : null;
    if (!ownerId) return;
    const accessToken = await getAccessTokenFor(ownerId);
    if (!accessToken) return;
    const { data: tasks } = await supabaseServer
      .from('tasks')
      .select('id, google_event_id')
      .eq('transaction_id', transactionId)
      .not('google_event_id', 'is', null);
    for (const task of tasks || []) {
      try {
        await deleteCalendarEvent(accessToken, task.google_event_id as string);
      } catch (error) {
        console.error(`Failed to delete calendar event for task ${task.id} (non-fatal):`, error);
      }
    }
  } catch (error) {
    console.error('Failed to remove transaction calendar events (non-fatal):', error);
  }
}
