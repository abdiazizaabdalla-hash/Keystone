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
import { getAgentListingRows } from './agentListings';
import { getCalendarPrefs, type CalendarPrefs } from './calendarPrefs';

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
  kind?: string | null;
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
      await supabaseServer.from('listing_agent_calendar_events').delete().eq('user_id', userId); // ignored if the table is not there yet
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
      .select('id, file_number, property_address, agent_id, tc_user_id, closing_date, status')
      .eq('id', transactionId)
      .maybeSingle();
    if (!tx) return;

    const label = `${tx.file_number} · ${tx.property_address}`;

    const [{ data: keyDates }, { data: agentLinks }, ownerId] = await Promise.all([
      supabaseServer
        .from('transaction_key_dates')
        .select('id, kind, label, due_date, completed')
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

      const prefs = await getCalendarPrefs(userId);
      await syncKeyDatesForUser(accessToken, userId, label, dates, mappings, prefs);
      await syncClosingForUser(accessToken, userId, transactionId, label, tx, dates, prefs);
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
          await syncOneTask(accessToken, label, task, prefs.deal_tasks);
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
    // Listings the TC owns (checklist steps, key dates, expiration)
    const { data: ownedListings } = await supabaseServer
      .from('listings')
      .select('id')
      .eq('tc_user_id', userId)
      .in('status', ['preparing', 'active', 'under_offer'])
      .limit(300);
    for (const row of ownedListings || []) await syncListingCalendar(row.id as string);
    await backfillAgentListings(userId);
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

/**
 * The deal's closing day (transactions.closing_date) is shown on the deal as "Closing" but is not a
 * row in transaction_key_dates, so it needs its own event. Skipped when a real "closing" key date
 * exists (that one is synced above), when the deal is closed, or when the date has passed.
 * Event ids live in transaction_closing_events (add-closing-calendar-events.sql); until that table
 * exists this quietly does nothing.
 */
async function syncClosingForUser(
  accessToken: string,
  userId: string,
  transactionId: string,
  label: string,
  tx: { closing_date?: string | null; status?: string | null },
  dates: KeyDateRow[],
  prefs: CalendarPrefs
): Promise<void> {
  try {
    const { data: existing, error } = await supabaseServer
      .from('transaction_closing_events')
      .select('google_event_id')
      .eq('transaction_id', transactionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return;

    const hasClosingKeyDate = dates.some((d) => d.kind === 'closing');
    const closing = tx.closing_date || null;
    const wanted = Boolean(prefs.closing_date && closing && closing >= todayIso() && tx.status !== 'Closed' && !hasClosingKeyDate);

    if (!wanted) {
      if (existing) {
        try {
          await deleteCalendarEvent(accessToken, existing.google_event_id as string);
        } catch (e) {
          console.error('Failed to delete closing-day event (non-fatal):', e);
        }
        await supabaseServer.from('transaction_closing_events').delete().eq('transaction_id', transactionId).eq('user_id', userId);
      }
      return;
    }

    const input: CalendarEventInput = {
      summary: `Closing — ${label}`,
      description: `Closing day for ${label}, from Relay TC.`,
      dueDate: closing as string,
    };
    if (existing) {
      try {
        await updateCalendarEvent(accessToken, existing.google_event_id as string, input);
        return;
      } catch (e) {
        if (!(e instanceof CalendarEventNotFoundError)) throw e;
      }
    }
    const eventId = await createCalendarEvent(accessToken, input);
    await supabaseServer
      .from('transaction_closing_events')
      .upsert({ transaction_id: transactionId, user_id: userId, google_event_id: eventId }, { onConflict: 'transaction_id,user_id' });
  } catch (error) {
    console.error(`Failed to sync closing day for ${transactionId} / ${userId} (non-fatal):`, error);
  }
}

async function syncKeyDatesForUser(
  accessToken: string,
  userId: string,
  label: string,
  dates: KeyDateRow[],
  mappings: { key_date_id: string; user_id: string; google_event_id: string }[],
  prefs: CalendarPrefs
): Promise<void> {
  const today = todayIso();
  for (const date of dates) {
    const existing = mappings.find((m) => m.key_date_id === date.id && m.user_id === userId);
    const isPast = date.due_date < today;
    const wanted = date.kind === 'closing' ? prefs.closing_date : prefs.critical_dates;

    // Completed dates, and kinds the user switched off in Calendar preferences, lose their event.
    // Dates already in the past that nobody has completed are simply left alone (no new clutter,
    // no deleting history).
    if (date.completed || !wanted) {
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

async function syncOneTask(accessToken: string, transactionLabel: string, task: SyncableTask, enabled = true): Promise<void> {
  const shouldHaveEvent = enabled && Boolean(task.due_date) && !task.completed;

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

    // Closing-day events (one per person who has it on their calendar).
    const { data: closingRows } = await supabaseServer
      .from('transaction_closing_events')
      .select('user_id, google_event_id')
      .eq('transaction_id', transactionId);
    for (const row of closingRows || []) {
      const token = await getAccessTokenFor(row.user_id as string);
      if (!token) continue;
      try {
        await deleteCalendarEvent(token, row.google_event_id as string);
      } catch (e) {
        console.error('Failed to delete closing-day event (non-fatal):', e);
      }
    }

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


// ---------------------------------------------------------------------------
// Listings (pre-contract). Only the TC who owns the listing syncs: unfinished checklist steps,
// the listing's own dates (open house, price review...), the planned go-live day is already a
// step, and the agreement's expiration date. Same contract as deals: Relay only touches events
// it created itself, and every failure is swallowed.
// ---------------------------------------------------------------------------

const OPEN_LISTING = ['preparing', 'active', 'under_offer'];

async function syncListingOwnerCalendar(listingId: string): Promise<void> {
  try {
    const { data: listing } = await supabaseServer
      .from('listings')
      .select('id, tc_user_id, property_address, status, expiration_date, google_expiration_event_id')
      .eq('id', listingId)
      .maybeSingle();
    if (!listing) return;
    const ownerId = listing.tc_user_id as string;
    const accessToken = await getAccessTokenFor(ownerId);
    if (!accessToken) return;
    const prefs = await getCalendarPrefs(ownerId);

    const label = `Listing · ${listing.property_address}`;
    const isOpen = OPEN_LISTING.includes(listing.status as string);
    const today = todayIso();

    // Expiration date
    const expiration = isOpen && prefs.listing_dates ? (listing.expiration_date as string | null) : null;
    const wantExp = Boolean(expiration) && (expiration as string) >= today;
    const expEventId = listing.google_expiration_event_id as string | null;
    if (!wantExp) {
      if (expEventId) {
        try {
          await deleteCalendarEvent(accessToken, expEventId);
        } catch (error) {
          console.error('Failed to delete listing expiration event (non-fatal):', error);
        }
        await supabaseServer.from('listings').update({ google_expiration_event_id: null }).eq('id', listingId);
      }
    } else {
      const input: CalendarEventInput = {
        summary: `Listing expires — ${listing.property_address}`,
        description: `The listing agreement for ${listing.property_address} expires. From Relay TC.`,
        dueDate: expiration as string,
      };
      try {
        let done = false;
        if (expEventId) {
          try {
            await updateCalendarEvent(accessToken, expEventId, input);
            done = true;
          } catch (error) {
            if (!(error instanceof CalendarEventNotFoundError)) throw error;
          }
        }
        if (!done) {
          const id = await createCalendarEvent(accessToken, input);
          await supabaseServer.from('listings').update({ google_expiration_event_id: id }).eq('id', listingId);
        }
      } catch (error) {
        console.error('Failed to sync listing expiration (non-fatal):', error);
      }
    }

    // Steps and extra dates share one routine: an item has an event when it is open, in the future-or-today and the listing is open.
    const syncItems = async (
      table: 'listing_tasks' | 'listing_dates',
      rows: { id: string; title: string; due_date: string | null; google_event_id: string | null; active: boolean }[],
      enabled: boolean
    ) => {
      for (const row of rows) {
        const want = enabled && isOpen && row.active && Boolean(row.due_date);
        if (!want) {
          if (row.google_event_id) {
            try {
              await deleteCalendarEvent(accessToken, row.google_event_id);
            } catch (error) {
              console.error(`Failed to delete ${table} event ${row.id} (non-fatal):`, error);
            }
            await supabaseServer.from(table).update({ google_event_id: null }).eq('id', row.id);
          }
          continue;
        }
        const input: CalendarEventInput = {
          summary: `${row.title} — ${label}`,
          description: `Relay TC listing item for ${listing.property_address}.`,
          dueDate: row.due_date as string,
        };
        try {
          if (row.google_event_id) {
            try {
              await updateCalendarEvent(accessToken, row.google_event_id, input);
              continue;
            } catch (error) {
              if (!(error instanceof CalendarEventNotFoundError)) throw error;
            }
          }
          const id = await createCalendarEvent(accessToken, input);
          await supabaseServer.from(table).update({ google_event_id: id }).eq('id', row.id);
        } catch (error) {
          console.error(`Failed to sync ${table} ${row.id} (non-fatal):`, error);
        }
      }
    };

    const [{ data: tasks }, { data: dates }] = await Promise.all([
      supabaseServer.from('listing_tasks').select('id, name, due_date, completed, google_event_id').eq('listing_id', listingId),
      supabaseServer.from('listing_dates').select('id, label, due_date, google_event_id').eq('listing_id', listingId),
    ]);
    await syncItems(
      'listing_tasks',
      (tasks || []).map((t) => ({ id: t.id as string, title: t.name as string, due_date: t.due_date as string | null, google_event_id: (t.google_event_id as string | null) ?? null, active: !t.completed })),
      prefs.listing_steps
    );
    await syncItems(
      'listing_dates',
      (dates || []).map((d) => ({
        id: d.id as string,
        title: d.label as string,
        due_date: d.due_date as string | null,
        google_event_id: (d.google_event_id as string | null) ?? null,
        active: (d.due_date as string) >= today, // past dates simply drop off
      })),
      prefs.listing_dates
    );

    await supabaseServer
      .from('calendar_connections')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('tc_user_id', ownerId)
      .eq('provider', 'google');
  } catch (error) {
    console.error('Listing calendar sync failed (non-fatal):', error);
  }
}

/** Brings the listing's owner (checklist, dates, expiration) and the shared agent (dates only) up to date. */
export async function syncListingCalendar(listingId: string): Promise<void> {
  await syncListingOwnerCalendar(listingId);
  await syncListingAgentCalendar(listingId);
}

export function queueListingCalendarSync(listingId: string): void {
  try {
    after(() => syncListingCalendar(listingId));
  } catch {
    void syncListingCalendar(listingId);
  }
}

/** Deletes every Google event for a listing. Call BEFORE deleting the listing. */
export async function removeListingCalendarEvents(listingId: string): Promise<void> {
  await removeListingAgentEvents(listingId);
  try {
    const { data: listing } = await supabaseServer
      .from('listings')
      .select('tc_user_id, google_expiration_event_id')
      .eq('id', listingId)
      .maybeSingle();
    if (!listing) return;
    const accessToken = await getAccessTokenFor(listing.tc_user_id as string);
    if (!accessToken) return;
    const ids: string[] = [];
    if (listing.google_expiration_event_id) ids.push(listing.google_expiration_event_id as string);
    const [{ data: tasks }, { data: dates }] = await Promise.all([
      supabaseServer.from('listing_tasks').select('google_event_id').eq('listing_id', listingId).not('google_event_id', 'is', null),
      supabaseServer.from('listing_dates').select('google_event_id').eq('listing_id', listingId).not('google_event_id', 'is', null),
    ]);
    for (const r of [...(tasks || []), ...(dates || [])]) ids.push(r.google_event_id as string);
    for (const id of ids) {
      try {
        await deleteCalendarEvent(accessToken, id);
      } catch (error) {
        console.error('Failed to delete listing calendar event (non-fatal):', error);
      }
    }
  } catch (error) {
    console.error('Failed to remove listing calendar events (non-fatal):', error);
  }
}

/** Deletes one Google event belonging to a listing's owner (used when a step or date is deleted). */
export async function removeListingEvent(listingId: string, eventId: string): Promise<void> {
  try {
    const { data: listing } = await supabaseServer.from('listings').select('tc_user_id').eq('id', listingId).maybeSingle();
    if (!listing) return;
    const accessToken = await getAccessTokenFor(listing.tc_user_id as string);
    if (!accessToken) return;
    await deleteCalendarEvent(accessToken, eventId);
  } catch (error) {
    console.error('Failed to delete listing calendar event (non-fatal):', error);
  }
}

// ---------------------------------------------------------------------------
// Listing agent (read-only). An agent who connected their own Google Calendar gets the listing's
// dates that the portal already shows them: go-live day, agreement expiration and the extra dates
// (open house, price review...). Never the TC's checklist, notes or documents. Only while the TC
// has "Share with the agent" on and the listing is open. Same contract as everywhere: Relay only
// touches events it created itself (recorded in listing_agent_calendar_events).
// ---------------------------------------------------------------------------

const escapeLikeText = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Connected agent accounts whose sign-in email matches the listing agent's email. */
async function connectedAgentUserIds(agentEmail: string): Promise<string[]> {
  const e = agentEmail.trim().toLowerCase();
  if (!e) return [];
  const { data, error } = await supabaseServer
    .from('calendar_connections')
    .select('tc_user_id')
    .eq('provider', 'google')
    .ilike('login_email', escapeLikeText(e))
    .limit(20);
  if (error) return []; // add-listing-agent-calendar.sql not run yet
  return (data || []).map((r) => r.tc_user_id as string);
}

export async function syncListingAgentCalendar(listingId: string, options: { onlyUserId?: string } = {}): Promise<void> {
  try {
    const { data: listing } = await supabaseServer
      .from('listings')
      .select('id, tc_user_id, agent_id, property_address, status, share_with_agent, planned_list_date, expiration_date')
      .eq('id', listingId)
      .maybeSingle();
    if (!listing) return;
    const { data: existingRows, error: existingError } = await supabaseServer
      .from('listing_agent_calendar_events')
      .select('id, user_id, item_key, google_event_id')
      .eq('listing_id', listingId);
    if (existingError) return; // table not created yet
    const existing = existingRows || [];

    const wanted = listing.share_with_agent === true && OPEN_LISTING.includes(listing.status as string);
    let recipients: string[] = [];
    if (wanted && listing.agent_id) {
      const { data: agent } = await supabaseServer.from('agents').select('email').eq('id', listing.agent_id).maybeSingle();
      recipients = (await connectedAgentUserIds((agent?.email as string | undefined) || '')).filter((id) => id !== listing.tc_user_id);
    }

    // What the agent should have on their calendar.
    const desired = new Map<string, CalendarEventInput>();
    if (wanted) {
      const today = todayIso();
      const address = listing.property_address as string;
      if (listing.planned_list_date && (listing.planned_list_date as string) >= today) {
        desired.set('planned', { summary: `Listing goes live — ${address}`, description: `Planned go-live day for ${address}, from Relay TC.`, dueDate: listing.planned_list_date as string });
      }
      if (listing.expiration_date && (listing.expiration_date as string) >= today) {
        desired.set('expiration', { summary: `Listing expires — ${address}`, description: `The listing agreement for ${address} expires. From Relay TC.`, dueDate: listing.expiration_date as string });
      }
      const { data: dates } = await supabaseServer.from('listing_dates').select('id, label, due_date').eq('listing_id', listingId);
      for (const d of dates || []) {
        if (d.due_date && (d.due_date as string) >= today) {
          desired.set(`date:${d.id}`, { summary: `${d.label} — Listing · ${address}`, description: `Listing date for ${address}, from Relay TC.`, dueDate: d.due_date as string });
        }
      }
    }

    const users = new Set<string>([...recipients, ...existing.map((r) => r.user_id as string)]);
    if (options.onlyUserId) {
      if (!users.has(options.onlyUserId)) return;
      users.clear();
      users.add(options.onlyUserId);
    }

    for (const userId of users) {
      const accessToken = await getAccessTokenFor(userId);
      if (!accessToken) continue;
      const isRecipient = recipients.includes(userId) && (await getCalendarPrefs(userId)).listing_dates;
      const mine = existing.filter((r) => r.user_id === userId);

      // Remove events that are no longer wanted (unshared, closed, date changed away or passed).
      for (const row of mine) {
        if (isRecipient && desired.has(row.item_key as string)) continue;
        try {
          await deleteCalendarEvent(accessToken, row.google_event_id as string);
        } catch (error) {
          console.error('Failed to delete listing agent calendar event (non-fatal):', error);
        }
        await supabaseServer.from('listing_agent_calendar_events').delete().eq('id', row.id);
      }
      if (!isRecipient) continue;

      for (const [key, input] of desired) {
        const row = mine.find((r) => r.item_key === key);
        try {
          if (row) {
            try {
              await updateCalendarEvent(accessToken, row.google_event_id as string, input);
              continue;
            } catch (error) {
              if (!(error instanceof CalendarEventNotFoundError)) throw error;
            }
          }
          const eventId = await createCalendarEvent(accessToken, input);
          await supabaseServer
            .from('listing_agent_calendar_events')
            .upsert({ listing_id: listingId, user_id: userId, item_key: key, google_event_id: eventId }, { onConflict: 'listing_id,user_id,item_key' });
        } catch (error) {
          console.error(`Failed to sync listing item ${key} for agent ${userId} (non-fatal):`, error);
        }
      }
    }
  } catch (error) {
    console.error('Listing agent calendar sync failed (non-fatal):', error);
  }
}

/** Deletes the agent-side Google events for a listing. Call BEFORE deleting the listing (the records go with it). */
async function removeListingAgentEvents(listingId: string): Promise<void> {
  try {
    const { data: rows, error } = await supabaseServer.from('listing_agent_calendar_events').select('user_id, google_event_id').eq('listing_id', listingId);
    if (error || !rows) return;
    const tokens = new Map<string, string | null>();
    for (const row of rows) {
      const userId = row.user_id as string;
      if (!tokens.has(userId)) tokens.set(userId, await getAccessTokenFor(userId));
      const token = tokens.get(userId);
      if (!token) continue;
      try {
        await deleteCalendarEvent(token, row.google_event_id as string);
      } catch (e) {
        console.error('Failed to delete listing agent calendar event (non-fatal):', e);
      }
    }
  } catch (error) {
    console.error('Failed to remove listing agent calendar events (non-fatal):', error);
  }
}

/** For an agent who just connected: put the shared listings' dates on their calendar. */
async function backfillAgentListings(userId: string): Promise<void> {
  const { data } = await supabaseServer.auth.admin.getUserById(userId);
  const user = data?.user;
  if (!user || user.app_metadata?.role !== 'agent' || !user.email) return;
  const rows = await getAgentListingRows(user.email);
  for (const row of rows) {
    if (OPEN_LISTING.includes(row.status as string)) await syncListingAgentCalendar(row.id as string, { onlyUserId: userId });
  }
}

/**
 * Saves an agent's sign-in email on their calendar connection (coordinators are left empty). With
 * `thenBackfill`, also puts their shared listings' dates on the calendar.
 */
export async function recordAgentLoginEmail(userId: string, thenBackfill = false): Promise<void> {
  try {
    const { data } = await supabaseServer.auth.admin.getUserById(userId);
    const user = data?.user;
    if (!user || user.app_metadata?.role !== 'agent' || !user.email) return;
    const { error } = await supabaseServer
      .from('calendar_connections')
      .update({ login_email: user.email.toLowerCase() })
      .eq('tc_user_id', userId)
      .eq('provider', 'google');
    if (error) return; // add-listing-agent-calendar.sql not run yet
    if (thenBackfill) {
      try {
        after(() => backfillAgentListings(userId));
      } catch {
        void backfillAgentListings(userId);
      }
    }
  } catch (error) {
    console.error('Recording the agent sign-in email failed (non-fatal):', error);
  }
}

/**
 * Removes every event Relay created on this person's Google Calendar -- deal critical dates,
 * closing days, checklist tasks, listing dates/steps/expiration and the agent-side listing
 * events -- then forgets the ids. Used by "Remove Relay events & disconnect". Relay only ever
 * deletes events whose ids it recorded itself; it never lists or touches anything else on the
 * calendar. Call BEFORE the connection row is deleted (the access token is needed).
 */
export async function removeAllCalendarEventsForUser(userId: string): Promise<{ removed: number; failed: number }> {
  const result = { removed: 0, failed: 0 };
  try {
    const accessToken = await getAccessTokenFor(userId);
    if (!accessToken) return result;

    const ids = new Set<string>();
    const clearers: Array<() => PromiseLike<unknown>> = [];
    const collect = (rows: { google_event_id?: unknown }[] | null | undefined) => {
      for (const r of rows || []) if (typeof r.google_event_id === 'string' && r.google_event_id) ids.add(r.google_event_id);
    };

    // Events recorded per person (critical dates, closing days, agent-side listing events).
    const [kd, closing, agentListing] = await Promise.all([
      supabaseServer.from('key_date_calendar_events').select('google_event_id').eq('user_id', userId),
      supabaseServer.from('transaction_closing_events').select('google_event_id').eq('user_id', userId),
      supabaseServer.from('listing_agent_calendar_events').select('google_event_id').eq('user_id', userId),
    ]);
    collect(kd.data);
    collect(closing.data);
    collect(agentListing.data);
    clearers.push(
      () => supabaseServer.from('key_date_calendar_events').delete().eq('user_id', userId),
      () => supabaseServer.from('transaction_closing_events').delete().eq('user_id', userId),
      () => supabaseServer.from('listing_agent_calendar_events').delete().eq('user_id', userId)
    );

    // Checklist tasks on deals this person owns (directly, or through one of their agents).
    const { data: myAgents } = await supabaseServer.from('agents').select('id').eq('tc_user_id', userId).limit(5000);
    const agentIds = (myAgents || []).map((a) => a.id as string);
    const txIds = new Set<string>();
    const { data: ownedTx } = await supabaseServer.from('transactions').select('id').eq('tc_user_id', userId).limit(5000);
    for (const t of ownedTx || []) txIds.add(t.id as string);
    for (let i = 0; i < agentIds.length; i += 200) {
      const { data: viaAgent } = await supabaseServer.from('transactions').select('id').in('agent_id', agentIds.slice(i, i + 200)).limit(5000);
      for (const t of viaAgent || []) txIds.add(t.id as string);
    }
    const txList = [...txIds];
    for (let i = 0; i < txList.length; i += 200) {
      const chunk = txList.slice(i, i + 200);
      const { data: tasks } = await supabaseServer.from('tasks').select('google_event_id').in('transaction_id', chunk).not('google_event_id', 'is', null);
      collect(tasks);
      clearers.push(() => supabaseServer.from('tasks').update({ google_event_id: null }).in('transaction_id', chunk).not('google_event_id', 'is', null));
    }

    // Listings this person owns: expiration, checklist steps, extra dates.
    const { data: myListings } = await supabaseServer.from('listings').select('id, google_expiration_event_id').eq('tc_user_id', userId).limit(5000);
    const listingIds = (myListings || []).map((l) => l.id as string);
    for (const l of myListings || []) if (l.google_expiration_event_id) ids.add(l.google_expiration_event_id as string);
    if (listingIds.length) {
      clearers.push(() => supabaseServer.from('listings').update({ google_expiration_event_id: null }).eq('tc_user_id', userId));
    }
    for (let i = 0; i < listingIds.length; i += 200) {
      const chunk = listingIds.slice(i, i + 200);
      const [lt, ld] = await Promise.all([
        supabaseServer.from('listing_tasks').select('google_event_id').in('listing_id', chunk).not('google_event_id', 'is', null),
        supabaseServer.from('listing_dates').select('google_event_id').in('listing_id', chunk).not('google_event_id', 'is', null),
      ]);
      collect(lt.data);
      collect(ld.data);
      clearers.push(
        () => supabaseServer.from('listing_tasks').update({ google_event_id: null }).in('listing_id', chunk).not('google_event_id', 'is', null),
        () => supabaseServer.from('listing_dates').update({ google_event_id: null }).in('listing_id', chunk).not('google_event_id', 'is', null)
      );
    }

    // Delete in small parallel batches (Google treats an already-deleted event as success).
    const all = [...ids];
    for (let i = 0; i < all.length; i += 5) {
      const results = await Promise.allSettled(all.slice(i, i + 5).map((id) => deleteCalendarEvent(accessToken, id)));
      for (const r of results) {
        if (r.status === 'fulfilled') result.removed += 1;
        else {
          result.failed += 1;
          console.error('Failed to delete a calendar event during removal (non-fatal):', r.reason);
        }
      }
    }

    // Forget the ids only when everything was removed, so a retry can finish the job.
    if (result.failed === 0) {
      for (const clear of clearers) {
        try {
          await clear();
        } catch (error) {
          console.error('Clearing stored calendar event ids failed (non-fatal):', error);
        }
      }
    }
  } catch (error) {
    console.error('Removing all calendar events failed (non-fatal):', error);
  }
  return result;
}
