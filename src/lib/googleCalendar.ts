const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Only what the sync in a later step needs to read/write events on the
// TC's calendar, plus their email for display -- deliberately NOT
// requesting full calendar or account access.
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

function getClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error('GOOGLE_CLIENT_ID is not set — cannot start a Google Calendar connection');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error('GOOGLE_CLIENT_SECRET is not set — cannot start a Google Calendar connection');
  return secret;
}

/** Builds the URL to send the TC to Google's consent screen. `redirectUri` must exactly match one registered in the Google Cloud Console OAuth client. */
export function getGoogleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline', // required to get a refresh_token back
    prompt: 'consent', // force a fresh refresh_token even on a reconnect
    scope: GOOGLE_SCOPES,
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/** Exchanges the one-time `code` from the OAuth redirect for an access + refresh token. `redirectUri` must be identical to the one used to build the auth URL. */
export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token exchange failed: ${response.status} ${text}`);
  }

  return response.json();
}

/** Uses a stored refresh_token to mint a new short-lived access_token. Called every time the sync needs to call the Calendar API (access tokens aren't persisted -- they're cheap to re-mint and expire in ~1 hour). */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token refresh failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/** Looks up the connected Google account's email, for a "Connected as you@gmail.com" display in Settings. Returns null rather than throwing -- this is cosmetic, never worth failing the connect flow over. */
export async function getGoogleUserEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.email === 'string' ? data.email : null;
  } catch {
    return null;
  }
}

const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** Thrown by updateCalendarEvent when Google no longer has the event (deleted by the user, or it expired) -- callers should treat this as "no event exists" and create a fresh one instead of failing. */
export class CalendarEventNotFoundError extends Error {}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  /** All-day event date, YYYY-MM-DD -- due dates are day-granularity, not specific times. */
  dueDate: string;
}

function eventBody(event: CalendarEventInput) {
  return {
    summary: event.summary,
    description: event.description,
    start: { date: event.dueDate },
    end: { date: event.dueDate },
  };
}

/** Creates an all-day event on the connected TC's primary calendar. Returns the new event's id, to store on the task row so future syncs update it instead of creating a duplicate. */
export async function createCalendarEvent(accessToken: string, event: CalendarEventInput): Promise<string> {
  const response = await fetch(GOOGLE_CALENDAR_API_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody(event)),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar create event failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.id;
}

/** Updates an existing event in place (e.g. its due date moved). Throws CalendarEventNotFoundError if Google no longer has it. */
export async function updateCalendarEvent(
  accessToken: string,
  eventId: string,
  event: CalendarEventInput
): Promise<void> {
  const response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventBody(event)),
  });

  if (response.ok) return;

  if (response.status === 404 || response.status === 410) {
    throw new CalendarEventNotFoundError();
  }

  const text = await response.text();
  throw new Error(`Google Calendar update event failed: ${response.status} ${text}`);
}

/** Deletes an event -- called when a task is completed or loses its due date. A 404/410 (already gone) is treated as success, not an error. */
export async function deleteCalendarEvent(accessToken: string, eventId: string): Promise<void> {
  const response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const text = await response.text();
    throw new Error(`Google Calendar delete event failed: ${response.status} ${text}`);
  }
}
