'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

const DISMISS_KEY = 'relay_agent_calendar_prompt_dismissed';

// One-time nudge on the agent's home page: set up your calendar once and every
// important date on your deals lands there automatically. Hidden once they have
// connected Google Calendar, or when they dismiss it (remembered in this browser only).
export default function AgentCalendarPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // Storage blocked: fall through and show it.
    }
    if (dismissed) return;

    (async () => {
      try {
        const res = await authFetch('/api/google-calendar/status');
        if (!res.ok) return;
        const data = await res.json();
        if (!data.connected && data.available) setShow(true);
      } catch {
        // Cosmetic prompt only: stay hidden on any error.
      }
    })();
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Not remembered; will show again next visit.
    }
  };

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-br from-blue-900/30 to-slate-800 border border-blue-700/50 rounded-lg px-5 py-4">
      <div className="min-w-0">
        <p className="text-slate-100 text-sm font-semibold">Put your deal dates on your calendar</p>
        <p className="text-slate-400 text-xs mt-0.5">
          Set it up once (about 30 seconds). Inspection, appraisal and closing dates then show up on their own and update if your TC changes them.
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Link
          href="/agent/settings#calendar"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition"
        >
          Set up calendar
        </Link>
        <button type="button" onClick={dismiss} className="text-xs text-slate-400 hover:text-slate-200">
          Not now
        </button>
      </div>
    </div>
  );
}
