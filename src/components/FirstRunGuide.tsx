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

export type GuideKind = 'transaction' | 'listing';
type Mode = GuideKind;

// The transaction tour and the listing tour are separate: each remembers its own step, topics and home page.
const storeKey = (base: 'step' | 'visited' | 'home', kind: Mode) => `relay_first_run_${base}_${kind}`;

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
export function resetFirstRunGuideLocal(kind: Mode) {
  writeStored(storeKey('step', kind), null);
  writeStored(storeKey('visited', kind), null);
  writeStored(storeKey('home', kind), null);
}

export async function saveFirstRunGuideDone(kind: Mode, done: boolean) {
  try {
    await authFetch('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kind === 'listing' ? { firstRunListingGuideDone: done } : { firstRunGuideDone: done }),
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
const CONTACTS_PAGE = /^\/dashboard\/contacts\/?$/;
const INVOICES_PAGE = /^\/dashboard\/invoices\/?$/;
const LISTING_DETAIL = /^\/dashboard\/listings\/(?!template)[^/]+\/?$/;

interface Ctx {
  pathname: string;
  /** Does a visible element with this data-tour name exist right now? */
  has: (name: string) => boolean;
  agents: number;
  agentNameTyped: boolean;
}

/** One thing to poke around in during the free-exploration step. */
interface HubItem {
  id: string;
  label: string;
  /** One line under the label in the list. */
  hint: string;
  /** data-tour name(s) to highlight. */
  target: string;
  /** Click this data-tour element first (a tab). */
  clickOnEnter?: string;
  /** Lives on the deal/listing page itself, so go back there first if needed. */
  needsHome?: boolean;
  /** When the person lands on this page, the highlight and text switch to the page's own pointer. */
  page?: RegExp;
  pageTarget?: string;
  pageTitle?: string;
  pageBody?: string;
  /** Also counts as having seen this first-visit page hint (PageHint). */
  hintId?: string;
  title: string;
  body: string;
}

interface Step {
  id: string;
  /** Pages this step belongs to; elsewhere the "Continue tutorial" card shows. */
  path: RegExp;
  /** Where "Continue tutorial" sends the person. */
  goto: string;
  /** data-tour name(s) to highlight, comma-separated for several; omitted = centered tip. */
  target?: string;
  title: string;
  body: string;
  /** Overrides the Next button's label. */
  nextLabel?: string;
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
  /** Free exploration: a list of things to try, in any order, at the person's own pace. */
  hub?: HubItem[];
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
    body: 'A name is all you need. If you add their email, Relay automatically gives them a free portal login when you create a deal, and they get an email about it. Just testing? Leave the email blank so no one is emailed.',
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
    title: 'Uploading a contract is optional',
    body: 'If you have a purchase contract handy, upload the PDF and Relay fills in the address, price, parties and key dates for you. No contract yet? Skip this and type the details in, or make a test transaction with a made-up address like 123 Test St. You can delete it later.',
    nextLabel: 'Continue without a contract',
  },
  {
    id: 'tx-agent',
    path: NEW_TX_PAGE,
    goto: '/dashboard/transactions/new',
    target: 'tx-agent,tx-invite',
    title: 'Pick the agent and decide on their invite',
    body: 'Choose which agent this deal is for. Right below, if the agent has an email, you decide whether they get a free portal invite now. Leave it ticked and they are added automatically, or untick it to invite them yourself from the deal later. Practicing? Untick it.',
  },
  {
    id: 'tx-fields',
    path: NEW_TX_PAGE,
    goto: '/dashboard/transactions/new',
    target: 'tx-address,tx-price',
    title: 'Type in the details',
    body: 'Enter the property address and the purchase price. Those are the only required details (a test address is fine). Add the acceptance and closing dates below if you have them and Relay can set due dates on your checklist. If a contract filled these in, just check them.',
  },
  {
    id: 'tx-submit',
    path: NEW_TX_PAGE,
    goto: '/dashboard/transactions/new',
    target: 'tx-submit',
    title: 'Create the transaction',
    body: 'Happy with the details? Create it and Relay builds the checklist for you. If the agent has an email, they are automatically invited to their portal, so practicing with a test agent that has no email keeps everything private.',
    action: 'Click “Create Transaction”.',
    advanceWhen: (c) => TX_DETAIL.test(c.pathname),
  },
  {
    id: 'tx-hub',
    path: IN_DASHBOARD,
    goto: '/dashboard',
    title: 'Explore your first transaction',
    body: 'Open anything, try things out, and come back to this list whenever you like.',
    hub: [
      {
        id: 'agent-portal',
        label: 'Your agent’s portal',
        hint: 'See who can open this deal',
        target: 'tx-portal-status',
        needsHome: true,
        title: 'Look for “Has portal access”',
        body: 'This line under the agent’s name shows their portal. When an agent has an email and the invite box was ticked, Relay set up a free login the moment you created the deal, and it reads “Has portal access”. They see this deal’s checklist, documents and messages, and nothing else. If you held off, or the agent has no email yet, click “Invite now” here to send it yourself whenever you are ready.',
      },
      {
        id: 'checklist',
        label: 'Checklist',
        hint: 'Check a step off or change a due date',
        target: 'tx-tab-checklist',
        clickOnEnter: 'tx-tab-checklist',
        needsHome: true,
        title: 'The checklist',
        body: 'Every step from contract to close lives here. Try it: check a step off, change a due date, or add your own step. Many steps have an Email button that opens a ready-made email template with the deal’s details filled in. The wording is editable, and your edits are saved for every deal.',
      },
      {
        id: 'documents',
        label: 'Documents and e-signatures',
        hint: 'Upload a file, send it to sign',
        target: 'tx-tab-documents',
        clickOnEnter: 'tx-tab-documents',
        needsHome: true,
        title: 'Documents and e-signatures',
        body: 'Keep every file for the deal here. Try it: upload any PDF, then send it out for e-signature.',
      },
      {
        id: 'people',
        label: 'Contacts on the deal',
        hint: 'Buyers, sellers, lender, title',
        target: 'tx-tab-people',
        clickOnEnter: 'tx-tab-people',
        needsHome: true,
        title: 'Everyone on the deal',
        body: 'Buyers, sellers, lender, title and escrow. Try it: add a contact. This is also where you give other people access to the deal.',
      },
      {
        id: 'overview',
        label: 'Overview and key dates',
        hint: 'Change a date, watch the checklist follow',
        target: 'tx-tab-overview',
        clickOnEnter: 'tx-tab-overview',
        needsHome: true,
        title: 'Overview and key dates',
        body: 'Try it: change the closing date and watch the checklist due dates move with it. Your calendar follows too.',
      },
      {
        id: 'invoices',
        label: 'Invoices',
        hint: 'Bill the agent when the deal closes',
        target: 'nav-invoices',
        page: INVOICES_PAGE,
        pageTarget: 'invoices-quickbooks',
        pageTitle: 'Use QuickBooks?',
        pageBody: 'Connect QuickBooks in Settings and every invoice you create here is created there too, with payments recorded. This button imports and exports files if you prefer.',
        hintId: 'invoices',
        title: 'Get paid',
        body: 'When a deal closes, invoice the agent from Invoices and track what is paid. Click it to look around; this list stays with you.',
      },
      {
        id: 'calendar',
        label: 'Calendar',
        hint: 'Every deal date in one place',
        target: 'nav-calendar',
        title: 'Never miss a date',
        body: 'Every deal date and due date shows up here, and you can sync it to Google Calendar. Click it to look around.',
      },
      {
        id: 'contacts',
        label: 'Contacts',
        hint: 'Everyone you work with',
        target: 'nav-contacts',
        page: CONTACTS_PAGE,
        pageTarget: 'contacts-import',
        pageTitle: 'Bring in your contacts',
        pageBody: 'Have a list somewhere else? Click Import CSV to bring it in. Relay flags duplicates, and you can undo an import for two minutes.',
        hintId: 'contacts',
        title: 'Your contacts',
        body: 'Everyone you work with in one list. People you add to a deal land here too, and you can import a CSV. Click it to look around.',
      },
      {
        id: 'listings',
        label: 'Listings',
        hint: 'Prep, showings and offers before the contract',
        target: 'nav-listings',
        title: 'Listings',
        body: 'Listings cover everything before the contract: prep, go-live, showings and offers. An accepted offer becomes a deal. Click it to look around.',
      },
    ],
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
    title: 'Uploading the agreement is optional',
    body: 'Have the signed listing agreement? Upload it and Relay fills in the address, price, dates and people. If not, just type an address, or make a test listing with a made-up one like 123 Test St. You can delete it later.',
    nextLabel: 'Continue without an agreement',
  },
  {
    id: 'ls-fields',
    path: LISTINGS_PAGE,
    goto: '/dashboard/listings',
    target: 'listing-address-field,listing-agent-field',
    title: 'Type in the details',
    body: 'Enter the property address and choose the listing agent. Those are the only required details (a test address is fine). If the agent has an email, a box appears asking whether to email them a portal invite now; untick it to invite them yourself later. Seller, price and dates are optional. If an agreement filled these in, just check them.',
  },
  {
    id: 'ls-submit',
    path: LISTINGS_PAGE,
    goto: '/dashboard/listings',
    target: 'listing-submit',
    title: 'Create the listing',
    body: 'Happy with the details? Create it and Relay adds the prep checklist for you. If the agent has an email, they are automatically invited to their portal, so practicing with a test agent that has no email keeps everything private.',
    action: 'Click “Create listing”.',
    advanceWhen: (c) => LISTING_DETAIL.test(c.pathname),
  },
  {
    id: 'ls-hub',
    path: IN_DASHBOARD,
    goto: '/dashboard',
    title: 'Explore your first listing',
    body: 'Open anything, try things out, and come back to this list whenever you like.',
    hub: [
      {
        id: 'agent-portal',
        label: 'Your agent’s portal',
        hint: 'Set up for you automatically',
        target: 'ls-portal-status',
        needsHome: true,
        title: 'Look for “Has portal access”',
        body: 'This line under the agent’s name shows their portal. When the agent has an email and the invite box was ticked, Relay invited them as soon as you created the listing, and it reads “Has portal access”. The listing then shows under Listings in their portal. If you held off, or they have no email yet, open Overview for the full explanation and a button to send the invite yourself.',
      },
      {
        id: 'checklist',
        label: 'Prep checklist',
        hint: 'Check a step off, watch the list date',
        target: 'ls-tab-checklist',
        clickOnEnter: 'ls-tab-checklist',
        needsHome: true,
        title: 'The prep checklist',
        body: 'Everything to do before go-live. Try it: check a step off or change a due date. Many steps have an Email button that opens a ready-made email template with the listing’s details filled in. The wording is editable, and your edits are saved for every listing.',
      },
      {
        id: 'offers',
        label: 'Offers and showings',
        hint: 'Log an offer, convert to a deal',
        target: 'ls-tab-offers',
        clickOnEnter: 'ls-tab-offers',
        needsHome: true,
        title: 'Offers and showings',
        body: 'Log showings and feedback and record offers. Try it: add a test offer. When one is accepted, convert it to a deal in one click.',
      },
      {
        id: 'documents',
        label: 'Documents',
        hint: 'Upload a file, send it to sign',
        target: 'ls-tab-documents',
        clickOnEnter: 'ls-tab-documents',
        needsHome: true,
        title: 'Documents and e-signatures',
        body: 'Keep the listing agreement and everything else here. Try it: upload any PDF, then send it out for e-signature.',
      },
      {
        id: 'details',
        label: 'Details and people',
        hint: 'Seller, agent, other people',
        target: 'ls-tab-details',
        clickOnEnter: 'ls-tab-details',
        needsHome: true,
        title: 'Details and people',
        body: 'The seller, the listing agent and anyone else on the agreement. Edit any of it here.',
      },
      {
        id: 'calendar',
        label: 'Calendar',
        hint: 'Every date in one place',
        target: 'nav-calendar',
        title: 'Never miss a date',
        body: 'Listing and deal dates show up here, and you can sync it to Google Calendar. Click it to look around.',
      },
      {
        id: 'contacts',
        label: 'Contacts',
        hint: 'Everyone you work with',
        target: 'nav-contacts',
        page: CONTACTS_PAGE,
        pageTarget: 'contacts-import',
        pageTitle: 'Bring in your contacts',
        pageBody: 'Have a list somewhere else? Click Import CSV to bring it in. Relay flags duplicates, and you can undo an import for two minutes.',
        hintId: 'contacts',
        title: 'Your contacts',
        body: 'Everyone you work with in one list. Sellers and people you add to a listing land here too, and you can import a CSV. Click it to look around.',
      },
      {
        id: 'transactions',
        label: 'Transactions',
        hint: 'Once there is a contract',
        target: 'nav-transactions',
        title: 'Transactions',
        body: 'When an offer is accepted, the listing converts to a deal here in one click, with its checklist and documents. Click it to look around.',
      },
    ],
    isLast: true,
  },
];

/** The first element with this data-tour name that is actually on screen (the sidebar and mobile menu can both exist). */
export function findTarget(name: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const el of Array.from(nodes)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const TIP_WIDTH = 330;
const TIP_HEIGHT_GUESS = 240;

/** Where to put a tip card so it never covers the highlighted element: below, above, right, left, else docked in a corner. */
export function placeTip(box: Box, vw: number, vh: number, w: number, h: number): React.CSSProperties {
  const gap = 16;
  const pad = 8;
  const clampLeft = (x: number) => Math.min(Math.max(pad, x), vw - w - pad);
  const clampTop = (y: number) => Math.min(Math.max(pad, y), vh - h - pad);
  const hi = { top: box.top - 6, bottom: box.top + box.height + 6, left: box.left - 6, right: box.left + box.width + 6 };
  if (hi.bottom + gap + h <= vh - pad) return { top: hi.bottom + gap, left: clampLeft(box.left), width: w };
  if (hi.top - gap - h >= pad) return { top: hi.top - gap - h, left: clampLeft(box.left), width: w };
  if (hi.right + gap + w <= vw - pad) return { top: clampTop(box.top), left: hi.right + gap, width: w };
  if (hi.left - gap - w >= pad) return { top: clampTop(box.top), left: hi.left - gap - w, width: w };
  // Nothing fits (a tall element on a small screen): dock in the corner with the most free room.
  return box.left + box.width / 2 > vw / 2 ? { bottom: pad, left: pad, width: Math.min(w, 280) } : { bottom: pad, right: pad, width: Math.min(w, 280) };
}

export default function FirstRunGuide({
  kind,
  restartKey,
  onFinished,
  onHintSeen,
}: {
  /** Which tour this is: the transaction tour and the listing tour are separate. */
  kind: GuideKind;
  /** Bumped by the layout's "Tutorial" menu to reopen the welcome screen. */
  restartKey: number;
  /** `saved` is true when the tour was finished or skipped for good (stored on the account). */
  onFinished: (kind: GuideKind, saved: boolean) => void;
  /** Called when a topic that doubles as a first-visit page hint has been shown. */
  onHintSeen?: (id: string) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const mode: Mode = kind;
  const [stepId, setStepId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [agents, setAgents] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [drifted, setDrifted] = useState(false);
  const [agentNameTyped, setAgentNameTyped] = useState(false);
  // Free-exploration step: which topic is open, which have been opened, and whether the card is minimized.
  const [hubItemId, setHubItemId] = useState<string | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const [hubMin, setHubMin] = useState(false);

  const enteredRef = useRef<string | null>(null);
  const scrolledRef = useRef<string | null>(null);
  const mismatchSince = useRef<number | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [tipH, setTipH] = useState(TIP_HEIGHT_GUESS);
  const autoTimer = useRef<number | null>(null);

  const steps = mode === 'listing' ? LISTING_STEPS : TRANSACTION_STEPS;

  // The tip card's real height, so it can be placed clear of what it points at.
  useEffect(() => {
    const h = tipRef.current?.offsetHeight;
    if (h && Math.abs(h - tipH) > 2) setTipH(h);
  }, [tipH, stepId, hubItemId, hubMin, drifted, box]);

  // Read per-browser state after mount so the first client render matches the server's.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setStepId(readStored(storeKey('step', kind)));
      try {
        const v = JSON.parse(readStored(storeKey('visited', kind)) || '[]');
        setVisited(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
      } catch {
        setVisited([]);
      }
      setAgents(await agentCount());
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [restartKey, kind]);

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
      setHubItemId(null);
      writeStored(storeKey('step', kind), next.id);
      setStepId(next.id);
    },
    [steps, kind]
  );

  /** Done for good: stored on the account so the tour never auto-starts again. */
  const finish = async () => {
    resetFirstRunGuideLocal(kind);
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    await saveFirstRunGuideDone(kind, true);
    onFinished(kind, true);
  };

  /** "Maybe later": hide it for now; it offers itself again on the next visit. */
  const later = () => {
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    onFinished(kind, false);
  };

  const begin = async () => {
    const list = steps;
    const count = await agentCount();
    setAgents(count);
    const ctx: Ctx = { pathname, has: () => false, agents: count, agentNameTyped: false };
    let i = 0;
    while (i < list.length && list[i].skipIf?.(ctx)) i += 1;
    const first = list[i];
    enteredRef.current = null;
    scrolledRef.current = null;
    writeStored(storeKey('step', kind), first.id);
    setStepId(first.id);
    // Land the person on the page the first step is about.
    if (!first.path.test(pathname)) router.push(first.goto);
  };

  const step = stepId ? steps[stepIndex(stepId)] ?? null : null;
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

      // Remember where the first deal/listing lives so the exploration list can bring the person back to it.
      const homeRe = mode === 'listing' ? LISTING_DETAIL : TX_DETAIL;
      const onHome = homeRe.test(pathname);
      if (onHome) writeStored(storeKey('home', kind), pathname);

      // In the free-exploration step the highlight follows the topic the person opened.
      const item = step.hub && hubItemId ? step.hub.find((h) => h.id === hubItemId) ?? null : null;
      const onItemPage = !!item?.page && item.page.test(pathname);
      const key = `${step.id}:${item?.id ?? ''}${onItemPage ? ':page' : ''}`;
      const targetName = step.hub ? (onItemPage ? item?.pageTarget : item?.target) : step.target;
      const clickName = step.hub ? item?.clickOnEnter : step.clickOnEnter;
      if (onItemPage && item?.hintId) onHintSeen?.(item.hintId);
      if (item?.needsHome && !onHome) {
        setBox(null);
        return;
      }

      if (clickName && enteredRef.current !== key) {
        const el = findTarget(clickName);
        if (el) {
          enteredRef.current = key;
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

      if (targetName) {
        // A step can highlight several elements at once (comma-separated): one box around all of them.
        const els = targetName
          .split(',')
          .map((n) => findTarget(n.trim()))
          .filter((e): e is HTMLElement => e !== null);
        if (els.length > 0) {
          if (scrolledRef.current !== key) {
            scrolledRef.current = key;
            els[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
          const rects = els.map((e) => e.getBoundingClientRect());
          const top = Math.min(...rects.map((x) => x.top));
          const left = Math.min(...rects.map((x) => x.left));
          const bottom = Math.max(...rects.map((x) => x.bottom));
          const right = Math.max(...rects.map((x) => x.right));
          setBox((prev) =>
            prev && prev.top === top && prev.left === left && prev.width === right - left && prev.height === bottom - top
              ? prev
              : { top, left, width: right - left, height: bottom - top }
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
  }, [step, ready, pathname, agents, idx, goToNext, router, mode, hubItemId, kind, onHintSeen]);

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

  const openHubItem = (item: HubItem) => {
    enteredRef.current = null;
    scrolledRef.current = null;
    setBox(null);
    setHubItemId(item.id);
    setVisited((prev) => {
      const next = prev.includes(`${step?.id}:${item.id}`) ? prev : [...prev, `${step?.id}:${item.id}`];
      writeStored(storeKey('visited', kind), JSON.stringify(next));
      return next;
    });
    // Topics that live on the deal/listing page: bring the person back to it first.
    const homeRe = mode === 'listing' ? LISTING_DETAIL : TX_DETAIL;
    if (item.needsHome && !homeRe.test(pathname)) {
      const home = readStored(storeKey('home', kind));
      router.push(home && homeRe.test(home) ? home : mode === 'listing' ? '/dashboard/listings' : '/dashboard/transactions');
    }
  };

  if (!ready) return null;

  // Welcome screen: shown until the tour is started, put off, or skipped for good.
  if (!step) {
    const isListing = kind === 'listing';
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
        <div className="w-full max-w-md bg-slate-800 border border-slate-600 rounded-2xl p-6 shadow-2xl">
          <h2 id="first-run-title" className="text-xl font-display font-semibold text-slate-100 mb-2">
            {isListing ? 'Take a quick tour of listings' : 'Welcome to Relay TC'}
          </h2>
          <p className="text-sm text-slate-300 mb-5">
            {isListing
              ? 'Listings cover everything before the contract: prep, go-live, showings and offers. We will walk you through making one, step by step. A test listing is fine, and you can delete it afterwards.'
              : 'The fastest way to learn Relay is to do one real file. We will walk you through it, step by step: add your agent, then start your first deal. A test transaction is fine. About five minutes.'}
          </p>
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={begin}
              className="w-full px-4 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-xl transition"
            >
              {isListing ? 'Start the listing tour' : 'Start the transaction tour'}
            </button>
            <button
              type="button"
              onClick={later}
              className="w-full px-4 py-3 border border-slate-500 text-slate-100 hover:bg-white/10 font-semibold rounded-xl transition"
            >
              Maybe later
            </button>
            <button type="button" onClick={finish} className="w-full px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition">
              {isListing ? 'I don’t need the listing tour' : 'I’ll explore on my own'}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-4 text-center">You can bring either tour back any time from “Tutorial” in the menu.</p>
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

  // Free exploration: a list of things to try in any order, then a light highlight on whichever is open.
  if (step.hub) {
    const items = step.hub;
    const item = hubItemId ? items.find((h) => h.id === hubItemId) ?? null : null;
    const seen = items.filter((h) => visited.includes(`${step.id}:${h.id}`)).length;
    const onPageItem = !!item?.page && item.page.test(pathname);
    const noun = mode === 'listing' ? 'listing' : 'transaction';

    if (hubMin) {
      return (
        <button
          type="button"
          onClick={() => setHubMin(false)}
          className="fixed bottom-4 right-4 z-[61] px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-full shadow-lg transition"
        >
          Tutorial · {seen}/{items.length} explored
        </button>
      );
    }

    return (
      <>
        {item && box && (
          <div
            aria-hidden
            className="fixed z-[60] pointer-events-none rounded-xl ring-2 ring-blue-400 transition-all duration-200"
            style={{
              top: box.top - 6,
              left: box.left - 6,
              width: box.width + 12,
              height: box.height + 12,
              boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.35), 0 0 24px 4px rgba(96, 165, 250, 0.55)',
            }}
          />
        )}
        <aside
          role="dialog"
          aria-label="Tutorial"
          className="fixed z-[61] bottom-4 right-4 left-4 sm:left-auto sm:w-80 max-h-[80vh] overflow-y-auto bg-slate-800 border border-blue-400/60 rounded-2xl shadow-2xl p-4"
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-base font-semibold text-slate-100">{item ? (onPageItem ? item.pageTitle : item.title) : step.title}</h3>
            <button type="button" onClick={() => setHubMin(true)} aria-label="Minimize tutorial" className="text-slate-400 hover:text-slate-200 text-lg leading-none px-1">
              –
            </button>
          </div>
          {item ? (
            <>
              <p className="text-sm text-slate-300 mb-3">{onPageItem ? item.pageBody : item.body}</p>
              {item.needsHome && !(mode === 'listing' ? LISTING_DETAIL : TX_DETAIL).test(pathname) && (
                <p className="text-xs text-slate-400 mb-3">Taking you back to your {noun}…</p>
              )}
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setHubItemId(null)}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition"
                >
                  ← All topics
                </button>
                <button type="button" onClick={finish} className="text-xs text-slate-500 hover:text-slate-300 transition">
                  Finish tutorial
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-300 mb-3">
                {step.body} Nothing here is permanent; a test {noun} can be deleted later.
              </p>
              <ul className="space-y-1.5 mb-3">
                {items.map((h) => {
                  const done = visited.includes(`${step.id}:${h.id}`);
                  return (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => openHubItem(h)}
                        className="w-full flex items-start gap-2.5 text-left rounded-lg border border-slate-600 hover:border-blue-400/70 hover:bg-white/5 px-3 py-2 transition"
                      >
                        <span
                          className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${
                            done ? 'bg-green-500/20 text-green-300 border border-green-500/50' : 'bg-slate-700 text-slate-400'
                          }`}
                        >
                          {done ? '✓' : '•'}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-100">{h.label}</span>
                          <span className="block text-xs text-slate-400">{h.hint}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={finish}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition"
                >
                  {seen >= items.length ? 'Finish tutorial' : 'I’m done exploring'}
                </button>
                <span className="text-xs text-slate-500">{seen}/{items.length} explored</span>
              </div>
            </>
          )}
        </aside>
      </>
    );
  }

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const narrow = vw < 640;
  const tipWidth = Math.min(TIP_WIDTH, vw - 24);

  let tipStyle: React.CSSProperties;
  if (box && !narrow) {
    tipStyle = placeTip(box, vw, vh, tipWidth, tipH);
  } else if (box && narrow) {
    // Phones: a sheet on whichever side has more free room, clear of the highlighted element.
    const spaceAbove = box.top;
    const spaceBelow = vh - (box.top + box.height);
    tipStyle = spaceBelow >= spaceAbove ? { bottom: 12, left: 12, right: 12 } : { top: 12, left: 12, right: 12 };
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
        ref={tipRef}
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
              {step.isLast ? 'Finish' : step.nextLabel || 'Next'}
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
