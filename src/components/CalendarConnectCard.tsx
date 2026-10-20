'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

// "Calendar" card shared by the TC settings page and the agent settings page.
// Two ways to get dates onto a calendar:
//   1. Connect Google Calendar -- Relay adds, updates and removes its own events.
//   2. Subscribe link (.ics) -- works in Apple, Outlook and Google Calendar with
//      no permissions at all; the calendar app refreshes it on its own.
// Either way it's a one-time setup: after that, dates the TC adds or moves show
// up on their own.

type Audience = 'tc' | 'agent';

interface GoogleStatus {
  connected: boolean;
  email: string | null;
  lastSyncedAt?: string | null;
  available?: boolean;
}
interface FeedLinks {
  url: string;
  webcalUrl: string;
}

export default function CalendarConnectCard({ audience }: { audience: Audience }) {
  const router = useRouter();
  const loginPath = audience === 'agent' ? '/agent/login' : '/auth';

  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [feed, setFeed] = useState<FeedLinks | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'reset' | null>(null);
  const [copied, setCopied] = useState(false);

  const handleAuthError = useCallback(
    (err: unknown): boolean => {
      if (err instanceof AuthRequiredError) {
        router.push(loginPath);
        return true;
      }
      return false;
    },
    [router, loginPath]
  );

  useEffect(() => {
    // Returning from Google's consent screen (see /api/google-calendar/callback).
    // Deferred so this isn't a synchronous setState inside the effect body.
    const result = new URLSearchParams(window.location.search).get('googleCalendar');
    const timer = setTimeout(() => {
      if (result === 'connected') {
        setMessage(
          audience === 'agent'
            ? 'Google Calendar connected. Your deals’ important dates are being added now.'
            : 'Google Calendar connected. Due dates and critical dates are being added now.'
        );
      } else if (result === 'no_refresh_token') {
        setMessage(
          'Google didn’t grant lasting access this time. Remove Relay TC under your Google Account’s third-party access, then connect again.'
        );
      } else if (result === 'error') {
        setMessage('Something went wrong connecting Google Calendar. Please try again.');
      }
    }, 0);

    const load = async () => {
      try {
        const [statusRes, feedRes] = await Promise.all([authFetch('/api/google-calendar/status'), authFetch('/api/calendar/feed')]);
        if (statusRes.ok) {
          const data = await statusRes.json();
          setStatus({ connected: Boolean(data.connected), email: data.email || null, lastSyncedAt: data.lastSyncedAt || null, available: data.available !== false });
        }
        if (feedRes.ok) setFeed(await feedRes.json());
      } catch (err) {
        if (!handleAuthError(err)) console.error('Error loading calendar settings:', err);
      }
    };
    load();
    return () => clearTimeout(timer);
  }, [audience, handleAuthError]);

  const connect = async () => {
    setBusy('connect');
    setMessage('');
    try {
      const res = await authFetch('/api/google-calendar/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: audience === 'agent' ? 'agent' : 'settings' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start Google Calendar connection');
      window.location.href = data.url;
    } catch (err) {
      if (handleAuthError(err)) return;
      setMessage(err instanceof Error ? err.message : 'Error connecting to Google Calendar');
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect Google Calendar? Relay will stop adding and updating events. Events already on your calendar stay until you delete them.')) return;
    setBusy('disconnect');
    setMessage('');
    try {
      const res = await authFetch('/api/google-calendar/disconnect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to disconnect Google Calendar');
      // Re-read the status so the card reflects whether the connect button is open to this user.
      const fresh = await authFetch('/api/google-calendar/status').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      setStatus({ connected: false, email: null, available: fresh ? fresh.available !== false : true });
      setMessage('Google Calendar disconnected.');
    } catch (err) {
      if (handleAuthError(err)) return;
      setMessage(err instanceof Error ? err.message : 'Error disconnecting Google Calendar');
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async () => {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage('Couldn’t copy automatically. Select the link and copy it by hand.');
    }
  };

  const resetLink = async () => {
    if (!confirm('Create a new link? Calendars using the old link will stop updating until you subscribe with the new one.')) return;
    setBusy('reset');
    try {
      const res = await authFetch('/api/calendar/feed', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset link');
      setFeed(data);
      setMessage('New link created. Re-subscribe in your calendar app with it.');
    } catch (err) {
      if (handleAuthError(err)) return;
      setMessage(err instanceof Error ? err.message : 'Error resetting link');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div id="calendar" className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6">
      <h2 className="text-lg font-bold text-slate-100 mb-1">Calendar</h2>
      <p className="text-sm text-slate-400 mb-5">
        {audience === 'agent'
          ? 'Set this up once and every important date on your deals (inspection, appraisal, closing and more) and on listings your TC shares with you (go-live day, open houses, expiration) shows up on your calendar by itself, and moves if your TC changes it.'
          : 'Set this up once and your deals’ critical dates and checklist due dates show up on your calendar by themselves, and move when you change them.'}
      </p>

      {message && <div className="mb-4 text-sm text-slate-300">{message}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className={`rounded-lg border p-5 ${status?.connected ? 'border-blue-500 bg-slate-800/50' : 'border-slate-600'}`}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="font-semibold text-slate-100 text-sm">Google Calendar</h3>
            {status?.connected && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-900/30 text-green-300 border border-green-700/50">
                Connected
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mb-4">
            {status?.connected
              ? `Connected as ${status.email || 'your Google account'}.${status.lastSyncedAt ? ` Last updated ${new Date(status.lastSyncedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : ''}`
              : 'Relay adds, updates and removes its own events on your primary calendar. It never reads your other events.'}
          </p>
          {status?.connected ? (
            <button
              type="button"
              onClick={disconnect}
              disabled={busy === 'disconnect'}
              className="text-sm px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 rounded-lg transition disabled:opacity-50"
            >
              {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : status && status.available === false ? (
            <p className="text-xs text-slate-400">Direct Google Calendar sync is coming soon. Use the calendar link next to this for now. It works with Google Calendar too.</p>
          ) : (
            <button
              type="button"
              onClick={connect}
              disabled={busy === 'connect' || status === null}
              className="text-sm px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
            >
              {busy === 'connect' ? 'Opening Google…' : 'Connect Google Calendar'}
            </button>
          )}
        </div>

        <div className="rounded-lg border border-slate-600 p-5">
          <h3 className="font-semibold text-slate-100 text-sm mb-2">Apple, Outlook, or any calendar</h3>
          <p className="text-xs text-slate-500 mb-4">
            Subscribe once with your private link. No sign-in needed, and it refreshes on its own (some calendar apps take a few hours).
          </p>
          {feed ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={copyLink}
                  className="text-sm px-4 py-2 bg-slate-600 hover:bg-slate-500 border border-slate-600 text-slate-100 font-semibold rounded-lg transition"
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <a
                  href={feed.webcalUrl}
                  className="text-sm px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 rounded-lg transition"
                >
                  Open in calendar app
                </a>
              </div>
              <p className="text-xs text-slate-500">
                In Google Calendar: Other calendars, <span className="text-slate-400">From URL</span>, paste the link. Anyone with this link can see your dates, so don’t share it.{' '}
                <button type="button" onClick={resetLink} disabled={busy === 'reset'} className="text-blue-400 hover:text-blue-300 underline disabled:opacity-50">
                  Make a new link
                </button>
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Loading your link…</p>
          )}
        </div>
      </div>
    </div>
  );
}
