'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { authFetch } from '@/lib/authClient';

/**
 * First-run guided tour for brand-new accounts.
 *
 * A welcome screen lets the person pick a path (transaction or listing), then
 * the tour walks them through the real screens: it sends them to Agents,
 * highlights "+ Add Agent" and the form, and once the agent is saved it
 * moves them on to the new-deal page (or listings) and highlights the
 * contract upload, the agent picker and the create button. After the deal is
 * created it opens it and points out the tabs (checklist, documents,
 * contacts) and the Invoices and Calendar links.
 *
 * Elements are found by `data-tour="..."` attributes placed on the real
 * pages. The highlight never blocks clicks (the person does the real
 * action), and a missing element just shows the tip centered, so a layout
 * change can never trap anyone in the tour. If the person wanders off the
 * page a step belongs to, a small "Continue tutorial" card takes them back.
 *
 * "Finished" is stored on the account (user_metadata.first_run_guide_done,
 * via PATCH /api/auth/me); the chosen path and current step are
 * per-browser conveniences only.
 */

type Mode = 'transaction' | 'listing';

const MODE_KEY = 'relay_first_run_mode';
const STEP_KEY = 'relay_first_run_step';

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
    // Non-critical -- the tour just forgets its place on reload.
  }
}

/** Forget the chosen path and step so the welcome screen shows again (used by "Restart tutorial"). */
export function resetFirstRunGuideLocal() {
  writeStored(MODE_KEY, null);
  writeStored(STEP_KEY, null);
}

export async function saveFirstRunGuideDone(done: boolean) {
  try {
    await authFetch('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstRunGuideDone: done }),
    });
  } catch {
    // Non-critical -- worst case the tour shows once more next visit.
  }
}

async function agentCount(): Promise<number> {
  try {
    const res = await authFetch('/api/agents');
    if (!res.ok) return 0;
    const data = await res.json();
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

const IN_DASHBOARD = /^\/dashboard/;
const AGENTS_PAGE = /^\/dashboard\/agents\/?$/;
const NEW_TX_PAGE = /^\/dashboard\/transactions\/new\/?$/;
const TX_DETAIL = /^\/dashboard\/transactions\/(?!new\/?$|import)[^/]+\/?$/;
const LISTINGS_PAGE = /^\/dashboard\/listings\/?$/;
const LISTING_DETAIL = /^\/dashboard\/listings\/(?!template)[^/]+\/?$/;

interface Ctx {
  pathname: string;
  /** Does a visible element with this data-tour name exist right now? */
  has: (name: string) => boolean;
  agents: number;
  agentNameTyped: boolean;
}

interface Step {
  id: string;
  /** Pages this step belongs to; elsewhere the "Continue tutorial" card shows. */
  path: RegExp;
  /** Where "Continue tutorial" sends the person. */
  goto: string;
  /** data-tour name to highlight; omitted = centered tip. */
  target?: string;
  title: string;
  body: string;
  /** Shown instead of a Next button when the person has to act. */
  action?: string;
  /** Step is passed over entirely when this is true. */
  skipIf?: (ctx: Ctx) => boolean;
  /** The step finishes by itself when this becomes true (the person did the thing). */
  advanceWhen?: (ctx: Ctx) => boolean;
  /** Programmatically click this data-tour element when the step starts (tabs). */
  clickOnEnter?: string;
  /** Hop to another page after a short pause (no Next button). */
  autoGoto?: string;
  /** Keep re-checking the agent count while on this step. */
  pollAgents?: boolean;
  isLast?: boolean;
}

const hasAgent = (c: Ctx) => c.agents > 0;

const AGENT_STEPS: Step[] = [
  {
    id: 'agent-open',
    path: AGENTS_PAGE,
    goto: '/dashboard/agents',
    target: 'add-agent-btn',
    title: 'First, add an agent',
    body: 'Every deal and listing belongs to an agent, the person you coordinate for.',
    action: 'Click “+ Add Agent”.',
    skipIf: hasAgent,
    advanceWhen: (c) => c.has('agent-name'),
  },
  {
    id: 'agent-name',
    path: AGENTS_PAGE,
    goto: '/dashboard/agents',
    target: 'agent-name',
    title: 'Type their name',
    body: 'A name is all you need. Add their email later and they get their own portal for documents and messages.',
    action: 'Type a name to continue.',
    skipIf: hasAgent,
    advanceWhen: (c) => c.agentNameTyped,
  },
  {
    id: 'agent-submit',
    path: AGENTS_PAGE,
    goto: '/dashboard/agents',
    target: 'agent-submit',
    title: 'Save the agent',
    body: 'Fees and brokerage are optional; you can edit them any time.',
    action: 'Click “Add Agent” to save.',
    skipIf: hasAgent,
    advanceWhen: hasAgent,
    pollAgents: true,
  },
];

const TRANSACTION_STEPS: Step[] = [
  ...AGENT_STEPS,
  {
    id: 'agent-done',
    path: IN_DASHBOARD,
    goto: '/dashboard/agents',
    title: 'Agent added',
    body: 'Now your first transaction. Taking you there…',
    autoGoto: '/dashboard/transactions/new',
    skipIf: (c) => NEW_TX_PAGE.test(c.pathname),
  },
  {
    id: 'tx-contract',
    path: NEW_TX_PAGE,
    goto: '/dashboard/transactions/new',
    target: 'contract-upload',
    title: 'Start from the contract',
    body: 'Upload the purchase contract PDF and Relay reads the address, price, parties and key dates and fills the form for you. You review everything before saving.',
  },
  {
    id: 'tx-agent',
    path: NEW_TX_PAGE,
    goto: '/dashboard/transactions/new',
    target: 'tx-agent',
    title: 'Pick the agent',
    body: 'Choose which agent this deal is for. Relay picks the one named on the contract when it can.',
  },
  {
    id: 'tx-submit',
    path: NEW_TX_PAGE,
    goto: '/dashboard/transactions/new',
    target: 'tx-submit',
    title: 'Create the transaction',
    body: 'Check the details, then create it. Relay builds the checklist for you.',
    action: 'Click “Create Transaction”.',
    advanceWhen: (c) => TX_DETAIL.test(c.pathname),
  },
  {
    id: 'tx-overview',
    path: TX_DETAIL,
    goto: '/dashboard/transactions',
    target: 'tx-tab-overview',
    title: 'Your first transaction',
    body: 'Overview holds the key dates, price and parties. Change a date here and the checklist due dates and your calendar follow.',
    clickOnEnter: 'tx-tab-overview',
  },
  {
    id: 'tx-checklist',
    path: TX_DETAIL,
    goto: '/dashboard/transactions',
    target: 'tx-tab-checklist',
    title: 'The checklist',
    body: 'Every step from contract to close lives here. Check things off, set due dates, and add your own steps.',
    clickOnEnter: 'tx-tab-checklist',
  },
  {
    id: 'tx-documents',
    path: TX_DETAIL,
    goto: '/dashboard/transactions',
    target: 'tx-tab-documents',
    title: 'Documents and e-signatures',
    body: 'Upload files here, send them out for e-signature, and keep everything for the deal in one place.',
    clickOnEnter: 'tx-tab-documents',
  },
  {
    id: 'tx-people',
    path: TX_DETAIL,
    goto: '/dashboard/transactions',
    target: 'tx-tab-people',
    title: 'Everyone on the deal',
    body: 'Buyers, sellers, lender, title and escrow. Relay adds the people it found on the contract.',
    clickOnEnter: 'tx-tab-people',
  },
  {
    id: 'nav-invoices',
    path: IN_DASHBOARD,
    goto: '/dashboard',
    target: 'nav-invoices',
    title: 'Get paid',
    body: 'When a deal closes, invoice the agent from Invoices and track what is paid.',
  },
  {
    id: 'nav-calendar',
    path: IN_DASHBOARD,
    goto: '/dashboard',
    target: 'nav-calendar',
    title: 'Never miss a date',
    body: 'Every deal date and due date shows on your calendar. You can sync it to Google Calendar from there.',
  },
  {
    id: 'finish',
    path: IN_DASHBOARD,
    goto: '/dashboard',
    title: 'You are set',
    body: 'That is the whole loop: agent, deal, checklist. The menu has everything else, and “Tutorial” brings this tour back any time.',
    isLast: true,
  },
];

const LISTING_STEPS: Step[] = [
  ...AGENT_STEPS,
  {
    id: 'agent-done',
    path: IN_DASHBOARD,
    goto: '/dashboard/agents',
    title: 'Agent added',
    body: 'Now your first listing. Taking you there…',
    autoGoto: '/dashboard/listings',
    skipIf: (c) => LISTINGS_PAGE.test(c.pathname),
  },
  {
    id: 'ls-new',
    path: LISTINGS_PAGE,
    goto: '/dashboard/listings',
    target: 'new-listing-btn',
    title: 'Start a listing',
    body: 'A listing covers everything before the contract: prep, go-live, showings and offers.',
    action: 'Click “+ New listing”.',
    advanceWhen: (c) => c.has('listing-address'),
  },
  {
    id: 'ls-upload',
    path: LISTINGS_PAGE,
    goto: '/dashboard/listings',
    target: 'listing-upload',
    title: 'Start from the agreement',
    body: 'Upload the signed listing agreement and Relay fills in the address, price, dates and people. You review before anything is saved. Or just type the address.',
  },
  {
    id: 'ls-submit',
    path: LISTINGS_PAGE,
    goto: '/dashboard/listings',
    target: 'listing-submit',
    title: 'Create the listing',
    body: 'Choose the listing agent, then create it. Relay adds the prep checklist.',
    action: 'Click “Create listing”.',
    advanceWhen: (c) => LISTING_DETAIL.test(c.pathname),
  },
  {
    id: 'ls-detail',
    path: LISTING_DETAIL,
    goto: '/dashboard/listings',
    title: 'Your first listing',
    body: 'The prep checklist, documents, showings and offers all live on this page. When an offer is accepted, convert it to a deal in one click.',
  },
  {
    id: 'nav-calendar',
    path: IN_DASHBOARD,
    goto: '/dashboard',
    target: 'nav-calendar',
    title: 'Never miss a date',
    body: 'Listing and deal dates show on your calendar. You can sync it to Google Calendar from there.',
  },
  {
    id: 'finish',
    path: IN_DASHBOARD,
    goto: '/dashboard',
    title: 'You are set',
    body: 'That is the whole loop. The menu has everything else, and “Tutorial” brings this tour back any time.',
    isLast: true,
  },
];

/** The first element with this data-tour name that is actually on screen (the sidebar and mobile menu can both exist). */
function findTarget(name: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const el of Array.from(nodes)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const TIP_WIDTH = 330;
const TIP_HEIGHT_GUESS = 210;

export default function FirstRunGuide({
  restartKey,
  onFinished,
}: {
  /** Bumped by the layout's "Tutorial" button to reopen the welcome screen. */
  restartKey: number;
  onFinished: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [stepId, setStepId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [agents, setAgents] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [drifted, setDrifted] = useState(false);
  const [agentNameTyped, setAgentNameTyped] = useState(false);

  const enteredRef = useRef<string | null>(null);
  const scrolledRef = useRef<string | null>(null);
  const mismatchSince = useRef<number | null>(null);
  const autoTimer = useRef<number | null>(null);

  const steps = mode === 'listing' ? LISTING_STEPS : TRANSACTION_STEPS;

  // Read per-browser state after mount so the first client render matches the server's.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const stored = readStored(MODE_KEY);
      const m: Mode | null = stored === 'transaction' || stored === 'listing' ? stored : null;
      setMode(m);
      setStepId(m ? readStored(STEP_KEY) : null);
      setAgents(await agentCount());
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [restartKey]);

  const ctxFor = useCallback(
    (): Ctx => ({
      pathname,
      has: (name) => findTarget(name) !== null,
      agents: agents ?? 0,
      agentNameTyped,
    }),
    [pathname, agents, agentNameTyped]
  );

  const stepIndex = (id: string | null) => (id ? steps.findIndex((s) => s.id === id) : -1);

  /** Move to the first step after `from` that is not skipped. */
  const goToNext = useCallback(
    (from: number, ctx: Ctx) => {
      let i = from + 1;
      while (i < steps.length && steps[i].skipIf?.(ctx)) i += 1;
      const next = steps[Math.min(i, steps.length - 1)];
      enteredRef.current = null;
      scrolledRef.current = null;
      mismatchSince.current = null;
      setDrifted(false);
      setBox(null);
      writeStored(STEP_KEY, next.id);
      setStepId(next.id);
    },
    [steps]
  );

  const finish = async () => {
    resetFirstRunGuideLocal();
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    await saveFirstRunGuideDone(true);
    onFinished();
  };

  const choose = async (picked: Mode) => {
    writeStored(MODE_KEY, picked);
    const list = picked === 'listing' ? LISTING_STEPS : TRANSACTION_STEPS;
    const count = await agentCount();
    setAgents(count);
    const ctx: Ctx = { pathname, has: () => false, agents: count, agentNameTyped: false };
    let i = 0;
    while (i < list.length && list[i].skipIf?.(ctx)) i += 1;
    const first = list[i];
    enteredRef.current = null;
    scrolledRef.current = null;
    writeStored(STEP_KEY, first.id);
    setMode(picked);
    setStepId(first.id);
    // Land the person on the page the first step is about.
    if (!first.path.test(pathname)) router.push(first.goto);
  };

  const step = mode && stepId ? steps[stepIndex(stepId)] ?? null : null;
  const idx = step ? stepIndex(step.id) : -1;

  // One lightweight tick: tracks the highlighted element, detects when the
  // person has done the step's action, and notices when they wander off.
  useEffect(() => {
    if (!step || !ready) return;
    const tick = () => {
      // The person's own typing in the agent form.
      const nameInput = findTarget('agent-name') as HTMLInputElement | null;
      const typed = !!nameInput && nameInput.value.trim().length > 0;
      setAgentNameTyped((prev) => (prev === typed ? prev : typed));

      const ctx: Ctx = { pathname, has: (n) => findTarget(n) !== null, agents: agents ?? 0, agentNameTyped: typed };

      // Skipped by current conditions (e.g. agent already exists).
      if (step.skipIf?.(ctx)) {
        goToNext(idx, ctx);
        return;
      }
      if (step.advanceWhen?.(ctx)) {
        goToNext(idx, ctx);
        return;
      }

      // Wrong page for this step? Only after it persists, so normal route changes don't flash a card.
      if (!step.path.test(pathname)) {
        if (mismatchSince.current === null) mismatchSince.current = Date.now();
        if (Date.now() - mismatchSince.current > 1200) setDrifted(true);
        setBox(null);
        return;
      }
      mismatchSince.current = null;
      setDrifted(false);

      if (step.clickOnEnter && enteredRef.current !== step.id) {
        const el = findTarget(step.clickOnEnter);
        if (el) {
          enteredRef.current = step.id;
          el.click();
        }
      }

      if (step.autoGoto && enteredRef.current !== step.id) {
        enteredRef.current = step.id;
        autoTimer.current = window.setTimeout(() => {
          router.push(step.autoGoto as string);
          // The next page (or next tick) moves us on; if we are already there the skipIf above handles it.
          goToNext(idx, { ...ctx, pathname: step.autoGoto as string });
        }, 1400);
      }

      if (step.target) {
        const el = findTarget(step.target);
        if (el) {
          if (scrolledRef.current !== step.id) {
            scrolledRef.current = step.id;
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
          const r = el.getBoundingClientRect();
          setBox((prev) =>
            prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
              ? prev
              : { top: r.top, left: r.left, width: r.width, height: r.height }
          );
        } else {
          setBox(null);
        }
      } else {
        setBox(null);
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [step, ready, pathname, agents, idx, goToNext, router]);

  // Keep the agent count fresh on the step that waits for the agent to be saved.
  useEffect(() => {
    if (!step?.pollAgents) return;
    let cancelled = false;
    const poll = async () => {
      const n = await agentCount();
      if (!cancelled) setAgents(n);
    };
    const id = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [step]);

  useEffect(() => {
    return () => {
      if (autoTimer.current) window.clearTimeout(autoTimer.current);
    };
  }, []);

  if (!ready) return null;

  // Welcome screen: shown until a path is chosen or the person skips.
  if (!mode || !step) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
        <div className="w-full max-w-md bg-slate-800 border border-slate-600 rounded-2xl p-6 shadow-2xl">
          <h2 id="first-run-title" className="text-xl font-display font-semibold text-slate-100 mb-2">
            Welcome to Relay TC
          </h2>
          <p className="text-sm text-slate-300 mb-5">
            The fastest way to learn Relay is to do one real file. We will walk you through it, step by step: add your agent, then start your first deal from the contract. About five minutes.
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

  // Off the page this step belongs to: a small card that takes them back.
  if (drifted) {
    return (
      <aside className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] sm:w-80 bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl p-4">
        <p className="text-sm font-semibold text-slate-100 mb-1">Tutorial paused</p>
        <p className="text-xs text-slate-400 mb-3">You can pick up where you left off: {step.title.toLowerCase()}.</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(step.goto)}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition"
          >
            Continue tutorial
          </button>
          <button type="button" onClick={finish} className="text-xs text-slate-500 hover:text-slate-300 transition">
            Skip tutorial
          </button>
        </div>
      </aside>
    );
  }

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const narrow = vw < 640;
  const tipWidth = Math.min(TIP_WIDTH, vw - 24);

  let tipStyle: React.CSSProperties;
  if (box && !narrow) {
    const below = box.top + box.height + 16 + TIP_HEIGHT_GUESS < vh;
    const top = below ? box.top + box.height + 14 : Math.max(12, box.top - TIP_HEIGHT_GUESS - 14);
    const left = Math.min(Math.max(12, box.left), vw - tipWidth - 12);
    tipStyle = { top, left, width: tipWidth };
  } else if (box && narrow) {
    // Phones: a sheet on whichever half the highlighted element is not in.
    tipStyle = box.top > vh / 2 ? { top: 12, left: 12, right: 12 } : { bottom: 12, left: 12, right: 12 };
  } else {
    tipStyle = narrow
      ? { bottom: 12, left: 12, right: 12 }
      : { top: '50%', left: '50%', width: tipWidth, transform: 'translate(-50%, -50%)' };
  }

  const progress = Math.round(((idx + 1) / steps.length) * 100);
  const centered = !box;

  return (
    <>
      {box && (
        <div
          aria-hidden
          className="fixed z-[60] pointer-events-none rounded-xl ring-2 ring-blue-400 transition-all duration-200"
          style={{
            top: box.top - 6,
            left: box.left - 6,
            width: box.width + 12,
            height: box.height + 12,
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.7), 0 0 24px 4px rgba(96, 165, 250, 0.55)',
          }}
        />
      )}
      {centered && <div aria-hidden className="fixed inset-0 z-[59] bg-slate-950/60 pointer-events-none" />}
      <div
        role="dialog"
        aria-label="Tutorial"
        className="fixed z-[61] bg-slate-800 border border-blue-400/60 rounded-2xl shadow-2xl p-4"
        style={tipStyle}
      >
        <div className="h-1 rounded-full bg-slate-700 overflow-hidden mb-3" aria-hidden>
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <h3 className="text-base font-semibold text-slate-100 mb-1">{step.title}</h3>
        <p className="text-sm text-slate-300 mb-3">{step.body}</p>
        {step.action && <p className="text-sm font-semibold text-blue-300 mb-3">{step.action}</p>}
        <div className="flex items-center justify-between gap-3">
          {!step.action && !step.autoGoto ? (
            <button
              type="button"
              onClick={step.isLast ? finish : () => goToNext(idx, ctxFor())}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition"
            >
              {step.isLast ? 'Finish' : 'Next'}
            </button>
          ) : (
            <span />
          )}
          {!step.isLast && (
            <button type="button" onClick={finish} className="text-xs text-slate-500 hover:text-slate-300 transition">
              Skip tutorial
            </button>
          )}
        </div>
      </div>
    </>
  );
}
