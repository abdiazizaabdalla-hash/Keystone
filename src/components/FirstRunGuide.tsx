'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authFetch } from '@/lib/authClient';

/**
 * First-run guide for brand-new accounts: a welcome screen, then a small
 * "Getting started" panel that stays on screen while the person adds their
 * first agent and creates their first deal (or listing). Step ticks come
 * from real data (agents / transactions / listings), so the guide can never
 * disagree with what has actually been done, and a short contextual tip
 * changes with the page they are on.
 *
 * Deliberately small: no element-anchored coach marks (they break whenever
 * a page's layout changes), and only the steps that are truly required to
 * make a first record are listed. Everything else (e-sign, calendar sync,
 * invoicing, contacts) is left for the person to discover from the
 * dashboard and the onboarding checklist.
 *
 * "Finished" is stored on the account (user_metadata.first_run_guide_done,
 * via PATCH /api/auth/me), so it follows the person across devices. The
 * chosen path (transaction vs listing) is a per-browser convenience only.
 */

type Mode = 'transaction' | 'listing';

const MODE_KEY = 'relay_first_run_mode';
const COLLAPSED_KEY = 'relay_first_run_collapsed';

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Non-critical -- the guide just forgets this choice on reload.
  }
}

interface Counts {
  agents: number;
  transactions: number;
  listings: number;
}

async function countOf(path: string): Promise<number> {
  try {
    const res = await authFetch(path);
    if (!res.ok) return 0;
    const data = await res.json();
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

/** Forget the chosen path so the welcome screen shows again (used by "Restart tutorial"). */
export function resetFirstRunGuideLocal() {
  writeStored(MODE_KEY, null);
  writeStored(COLLAPSED_KEY, null);
}

export async function saveFirstRunGuideDone(done: boolean) {
  try {
    await authFetch('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstRunGuideDone: done }),
    });
  } catch {
    // Non-critical -- worst case the guide shows once more next visit.
  }
}

function tipFor(pathname: string, mode: Mode | null, counts: Counts): string | null {
  if (pathname.startsWith('/dashboard/agents')) {
    return 'Add the agent you coordinate for. A name is enough to start; add their email later and they get their own portal.';
  }
  if (pathname.startsWith('/dashboard/transactions/new')) {
    return 'Upload the purchase contract and Relay fills in the form for you. Check it, choose the agent, then create the deal.';
  }
  if (pathname.startsWith('/dashboard/listings') && mode === 'listing') {
    return 'Click “+ New listing”, upload the listing agreement, and review what Relay filled in before saving.';
  }
  if (/^\/dashboard\/transactions\/[^/]+$/.test(pathname) && counts.transactions > 0) {
    return 'This is your deal. The checklist, documents, parties, key dates and invoice all live on this page.';
  }
  if (/^\/dashboard\/listings\/[^/]+$/.test(pathname) && counts.listings > 0) {
    return 'This is your listing. Prep checklist, documents, showings and offers all live here.';
  }
  return null;
}

export default function FirstRunGuide({
  restartKey,
  onFinished,
}: {
  /** Bumped by the layout's "Restart tutorial" button to reopen the welcome screen. */
  restartKey: number;
  onFinished: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);

  // Read per-browser state after mount so the first client render matches the server's.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const stored = readStored(MODE_KEY);
      setMode(stored === 'transaction' || stored === 'listing' ? stored : null);
      setCollapsed(readStored(COLLAPSED_KEY) === 'true');
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [restartKey]);

  // Re-count on every page change so the steps tick off as soon as the person
  // returns from saving something.
  const refresh = useCallback(async () => {
    const [agents, transactions, listings] = await Promise.all([
      countOf('/api/agents'),
      countOf('/api/transactions'),
      countOf('/api/listings'),
    ]);
    setCounts({ agents, transactions, listings });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, restartKey, refresh]);

  const finish = async () => {
    writeStored(MODE_KEY, null);
    writeStored(COLLAPSED_KEY, null);
    await saveFirstRunGuideDone(true);
    onFinished();
  };

  const choose = (picked: Mode) => {
    writeStored(MODE_KEY, picked);
    setMode(picked);
    if (picked === 'transaction') {
      router.push(counts && counts.agents > 0 ? '/dashboard/transactions/new' : '/dashboard/agents');
    } else {
      router.push(counts && counts.agents > 0 ? '/dashboard/listings' : '/dashboard/agents');
    }
  };

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      writeStored(COLLAPSED_KEY, String(!c));
      return !c;
    });
  };

  if (!ready || !counts) return null;

  // Welcome screen: shown until a path is chosen or the person skips.
  if (!mode) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
        <div className="w-full max-w-md bg-slate-800 border border-slate-600 rounded-2xl p-6 shadow-2xl">
          <h2 id="first-run-title" className="text-xl font-display font-semibold text-slate-100 mb-2">
            Welcome to Relay TC
          </h2>
          <p className="text-sm text-slate-300 mb-5">
            The fastest way to learn Relay is to do one real file. It takes about five minutes: add your agent, then start your first deal from the contract. Relay does the typing.
          </p>
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => choose('transaction')}
              className="w-full px-4 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-xl transition"
            >
              Create my first transaction
            </button>
            <button
              type="button"
              onClick={() => choose('listing')}
              className="w-full px-4 py-3 border border-slate-500 text-slate-100 hover:bg-white/10 font-semibold rounded-xl transition"
            >
              Start with a listing instead
            </button>
            <button type="button" onClick={finish} className="w-full px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition">
              Explore Relay on my own
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-4 text-center">You can bring this back any time from “Tutorial” in the menu.</p>
        </div>
      </div>
    );
  }

  const madeRecord = mode === 'transaction' ? counts.transactions > 0 : counts.listings > 0;
  const hasAgent = counts.agents > 0;
  const noun = mode === 'transaction' ? 'transaction' : 'listing';

  const steps: { label: string; done: boolean; href: string; cta: string }[] = [
    { label: 'Add your first agent', done: hasAgent, href: '/dashboard/agents', cta: 'Add agent' },
    mode === 'transaction'
      ? { label: 'Create your first transaction from a contract', done: madeRecord, href: '/dashboard/transactions/new', cta: 'New transaction' }
      : { label: 'Create your first listing from the agreement', done: madeRecord, href: '/dashboard/listings', cta: 'Open listings' },
  ];
  const nextIndex = steps.findIndex((s) => !s.done);
  const tip = tipFor(pathname, mode, counts);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        className="fixed bottom-4 right-4 z-40 px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-full shadow-lg transition"
      >
        {madeRecord ? 'Setup complete' : `Getting started · ${steps.filter((s) => s.done).length}/${steps.length}`}
      </button>
    );
  }

  return (
    <aside
      aria-label="Getting started"
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-40 sm:w-80 bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl p-4"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-slate-100">{madeRecord ? `Your first ${noun} is ready` : 'Getting started'}</h3>
        <button type="button" onClick={toggleCollapsed} aria-label="Minimize" className="text-slate-400 hover:text-slate-200 text-lg leading-none px-1">
          –
        </button>
      </div>

      {madeRecord ? (
        <>
          <p className="text-sm text-slate-300 mb-3">
            Nice work. Open it to see the checklist and where documents, people, key dates and invoicing live. More tools (e-sign, calendar sync, contacts) are in the menu whenever you want them.
          </p>
          <button type="button" onClick={finish} className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">
            Finish tutorial
          </button>
        </>
      ) : (
        <>
          <ol className="space-y-2 mb-3">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    s.done ? 'bg-green-500/20 text-green-300 border border-green-500/50' : i === nextIndex ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {s.done ? '✓' : i + 1}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm ${s.done ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{s.label}</p>
                  {i === nextIndex && !pathname.startsWith(s.href) && (
                    <Link href={s.href} className="text-xs font-semibold text-blue-300 hover:text-blue-200">
                      {s.cta} →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {tip && <p className="text-xs text-slate-300 bg-slate-900/60 border border-slate-700 rounded-lg p-2.5 mb-3">{tip}</p>}
          <button type="button" onClick={finish} className="text-xs text-slate-500 hover:text-slate-300 transition">
            Skip tutorial
          </button>
        </>
      )}
    </aside>
  );
}
