'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

// The Calendar tab: one month at a time, every date from your own deals and listings, colored by kind.
// The "What goes on my calendar" switches are the same preferences the Google/Outlook/Apple calendar link
// and the Google sync use, so what you see here is what lands on your calendar.

type Kind = 'critical' | 'closing' | 'task' | 'listing_date' | 'listing_step';
type PrefKey = 'critical_dates' | 'closing_date' | 'deal_tasks' | 'listing_dates' | 'listing_steps';
type Prefs = Record<PrefKey, boolean>;

interface CalEvent {
  id: string;
  date: string;
  title: string;
  detail: string;
  kind: Kind;
  href: string;
}

const KINDS: { kind: Kind; pref: PrefKey; label: string; hint: string; chip: string; dot: string }[] = [
  { kind: 'critical', pref: 'critical_dates', label: 'Critical dates', hint: 'Earnest money, inspection, appraisal, financing, title', chip: 'bg-blue-600 text-white', dot: 'bg-blue-500' },
  { kind: 'closing', pref: 'closing_date', label: 'Closing day', hint: 'The closing date on each deal', chip: 'bg-amber-600 text-white', dot: 'bg-amber-500' },
  { kind: 'task', pref: 'deal_tasks', label: 'Deal checklist due dates', hint: 'Your transaction checklist steps', chip: 'bg-cyan-600 text-white', dot: 'bg-cyan-500' },
  { kind: 'listing_date', pref: 'listing_dates', label: 'Listing dates', hint: 'Go-live day, expiration, open houses, price reviews', chip: 'bg-violet-600 text-white', dot: 'bg-violet-500' },
  { kind: 'listing_step', pref: 'listing_steps', label: 'Listing checklist steps', hint: 'Your pre-listing checklist', chip: 'bg-fuchsia-600 text-white', dot: 'bg-fuchsia-500' },
];
const KIND_BY = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<Kind, (typeof KINDS)[number]>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function CalendarPage() {
  const router = useRouter();
  const today = new Date();
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());
  const [showSettings, setShowSettings] = useState(false);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [savingPref, setSavingPref] = useState<PrefKey | null>(null);

  // The grid always starts on a Sunday and runs whole weeks, so leading/trailing days of the neighbouring
  // months show their dates too.
  const days = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const count = Math.ceil((first.getDay() + new Date(year, month + 1, 0).getDate()) / 7) * 7;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { iso: iso(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === month };
    });
  }, [year, month]);

  const handleAuth = useCallback(
    (err: unknown) => {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return true;
      }
      return false;
    },
    [router]
  );

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/calendar/preferences');
        if (res.ok && !cancelled) setPrefs(await res.json());
      } catch (err) {
        if (!handleAuth(err)) console.error(err);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [handleAuth]);

  const from = days[0]?.iso;
  const to = days[days.length - 1]?.iso;
  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await authFetch(`/api/calendar/events?from=${from}&to=${to}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load calendar');
        if (!cancelled) setEvents(data);
      } catch (err) {
        if (handleAuth(err)) return;
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load calendar');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [from, to, handleAuth]);

  const visible = useMemo(() => events.filter((e) => !prefs || prefs[KIND_BY[e.kind].pref]), [events, prefs]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of visible) {
      const list = map.get(e.date) || [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [visible]);

  const goMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setOpenDay(null);
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setOpenDay(null);
  };

  const togglePref = async (key: PrefKey) => {
    if (!prefs || savingPref) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSavingPref(key);
    try {
      const res = await authFetch('/api/calendar/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next[key] }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not save');
    } catch (err) {
      if (!handleAuth(err)) {
        setPrefs(prefs);
        setError(err instanceof Error ? err.message : 'Could not save');
      }
    } finally {
      setSavingPref(null);
    }
  };

  const monthEvents = visible.filter((e) => e.date.startsWith(`${year}-${pad(month + 1)}`));
  const openDayEvents = openDay ? byDay.get(openDay) || [] : [];

  return (
    <div className="p-4 md:p-10 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="mr-auto">
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100">Calendar</h1>
          <p className="text-slate-400 text-sm mt-1">Every date from your deals and listings, in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => goMonth(-1)} aria-label="Previous month" className="px-3 py-2 rounded-lg border border-white/10 text-slate-200 hover:bg-white/5 transition">‹</button>
          <button onClick={goToday} className="px-3 py-2 rounded-lg border border-white/10 text-slate-200 hover:bg-white/5 text-sm font-medium transition">Today</button>
          <button onClick={() => goMonth(1)} aria-label="Next month" className="px-3 py-2 rounded-lg border border-white/10 text-slate-200 hover:bg-white/5 transition">›</button>
          <span className="ml-2 min-w-[9rem] text-lg font-display font-semibold text-slate-100">{MONTHS[month]} {year}</span>
          <button
            onClick={() => setShowSettings((o) => !o)}
            aria-expanded={showSettings}
            className="ml-2 px-3 py-2 rounded-xl border border-white/10 text-slate-200 hover:bg-white/5 text-sm font-medium transition"
          >
            Calendar settings
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="grid gap-6 items-start">
        <div>
          {/* Month grid (tablet and up) */}
          <div className="hidden sm:block bg-white/5 border border-white/10 rounded-2xl p-3">
            <div className="grid grid-cols-7 gap-1.5 mb-1.5">
              {DOW.map((d) => (
                <div key={d} className="text-center text-xs text-slate-500 py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {days.map((cell) => {
                const list = byDay.get(cell.iso) || [];
                const isToday = cell.iso === todayIso;
                return (
                  <div
                    key={cell.iso}
                    className={`min-h-[6.5rem] rounded-lg border p-1.5 ${
                      cell.inMonth ? 'bg-slate-900/70 border-slate-700/80' : 'bg-slate-900/30 border-slate-800/60'
                    }`}
                  >
                    <div className={`text-xs mb-1 ${cell.inMonth ? 'text-slate-400' : 'text-slate-600'}`}>
                      {isToday ? (
                        <span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-blue-500 text-white font-semibold">{cell.day}</span>
                      ) : (
                        <span className="font-semibold">{cell.day}</span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {list.slice(0, 3).map((e) => (
                        <Link
                          key={e.id}
                          href={e.href}
                          title={`${e.title} — ${e.detail}`}
                          className={`block truncate rounded px-1.5 py-0.5 text-[11px] font-semibold leading-snug ${KIND_BY[e.kind].chip} hover:brightness-110 transition`}
                        >
                          {e.title}
                        </Link>
                      ))}
                      {list.length > 3 && (
                        <button onClick={() => setOpenDay(cell.iso)} className="text-[11px] text-blue-400 hover:text-blue-300">
                          +{list.length - 3} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Agenda list (phones) */}
          <div className="sm:hidden space-y-2">
            {monthEvents.length === 0 && !loading && <p className="text-slate-500 text-sm">Nothing on the calendar this month.</p>}
            {monthEvents.map((e) => (
              <Link key={e.id} href={e.href} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-3 py-2.5">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${KIND_BY[e.kind].dot}`} />
                <span className="min-w-0">
                  <span className="block text-sm text-slate-100 truncate">{e.title}</span>
                  <span className="block text-xs text-slate-500 truncate">{e.detail}</span>
                </span>
                <span className="ml-auto text-xs text-slate-400 shrink-0">{e.date.slice(5).replace('-', '/')}</span>
              </Link>
            ))}
          </div>

          {openDay && (
            <div className="mt-4 bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display font-semibold text-slate-100">{openDay}</h2>
                <button onClick={() => setOpenDay(null)} className="text-xs text-slate-400 hover:text-slate-200">Close</button>
              </div>
              <div className="space-y-2">
                {openDayEvents.map((e) => (
                  <Link key={e.id} href={e.href} className="flex items-center gap-3 bg-slate-950/40 border border-white/10 rounded-xl px-3 py-2">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${KIND_BY[e.kind].dot}`} />
                    <span className="text-sm text-slate-100">{e.title}</span>
                    <span className="ml-auto text-xs text-slate-500 truncate">{e.detail}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {loading && <p className="mt-3 text-xs text-slate-500">Loading…</p>}
        </div>

        <aside className={showSettings ? 'grid md:grid-cols-2 gap-4' : 'hidden'}>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase mb-3">What goes on my calendar</h2>
            <div className="space-y-2">
              {KINDS.map((k) => (
                <label key={k.pref} className="flex items-start gap-3 bg-slate-950/40 border border-white/10 rounded-xl px-3 py-2.5 cursor-pointer">
                  <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${k.dot}`} />
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-100">{k.label}</span>
                    <span className="block text-xs text-slate-500">{k.hint}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs ? prefs[k.pref] : true}
                    disabled={!prefs || savingPref === k.pref}
                    onChange={() => togglePref(k.pref)}
                    className="ml-auto mt-1 w-4 h-4 accent-blue-500 shrink-0"
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-3">These choices also decide what goes to your Google, Outlook or Apple calendar.</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase mb-2">Put it on your own calendar</h2>
            <p className="text-sm text-slate-400 mb-3">Add your private Relay calendar link to Google Calendar, Outlook or Apple Calendar, so dates show up where you already look.</p>
            <Link href="/dashboard/settings" className="inline-block px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">
              Calendar settings
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
