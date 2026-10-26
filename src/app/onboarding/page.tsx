'use client';

import MoneyInput from '@/components/MoneyInput';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authFetch, AuthRequiredError, clearSession } from '@/lib/authClient';
import { DueDateSpec, normalizeDueDateSpec } from '@/lib/dueDates';
import DueDateControl from '@/components/DueDateControl';

import { PLANS, PUBLIC_PLANS, type PlanId } from '@/lib/plans';

// Onboarding walks a new account through the settings that matter before
// dropping them at the dashboard:
//   1. Choose plan
//   2. About you (full name)
//   3. Fees and invoicing (agent fee pre-fills + invoice due-in days)
//   4. Deal checklist (baseline + automatic due dates)
//   5. How agents pay you (Stripe Connect vs. collect it yourself)
//   6. Launchpad: jump straight into the first thing to set up (AI contract
//      intake, agents, contacts, imports, calendar link, listings,
//      QuickBooks, and Collaborate on Team plans)
// Each settings step saves immediately via PATCH /api/auth/me before
// advancing -- the same endpoint and fields the Settings page uses -- so
// someone who closes the tab partway through keeps what they filled in.
const TOTAL_STEPS = 6;
const STEP_LABELS = ['Plan', 'You', 'Fees', 'Checklist', 'Payments', 'Start'];

const inputClass =
  'w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

// Progress bar across the top of every step. Module scope (not nested in
// OnboardingContent) so its identity is stable across renders.
function ProgressHeader({ current }: { current: number }) {
  return (
    <nav aria-label="Setup progress" className="max-w-3xl mx-auto mb-8">
      <p className="sr-only">
        Step {current} of {TOTAL_STEPS}
      </p>
      <ol className="flex items-start gap-2">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          return (
            <li key={label} className="flex-1" aria-current={active ? 'step' : undefined}>
              <div className={`h-1.5 rounded-full ${active ? 'bg-blue-400' : done ? 'bg-blue-500/60' : 'bg-white/10'}`} />
              <span
                className={`mt-2 text-xs font-medium ${active ? 'block text-blue-300' : 'hidden sm:block'} ${
                  done ? 'text-slate-300' : active ? '' : 'text-slate-500'
                }`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// Shared card for the settings steps (2-4): title, description, the step's
// own fields, an inline error, and Back/Continue controls. Module scope for
// the same reason as above -- defining it inside the page component would
// remount it (and drop input focus) on every keystroke.
function StepShell({
  title,
  description,
  badge,
  children,
  onBack,
  onContinue,
  continueLabel = 'Continue',
  saving,
  error,
}: {
  title: string;
  description: string;
  badge?: string;
  children: React.ReactNode;
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  saving: boolean;
  error: string;
}) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4 mb-1">
          <h1 className="text-2xl font-display font-semibold text-slate-100">{title}</h1>
          {badge && (
            <span className="inline-block px-2.5 py-1 bg-blue-500/20 border border-blue-500/50 text-blue-300 text-xs font-semibold rounded-full shrink-0">
              {badge}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-400 mb-6">{description}</p>

        {children}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="flex gap-3 mt-8">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="px-5 py-2.5 border border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100 rounded-xl font-semibold transition"
            >
              ← Back
            </button>
          )}
          <button
            type="button"
            onClick={onContinue}
            disabled={saving}
            className="flex-1 px-5 py-2.5 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-xl transition disabled:opacity-50"
          >
            {saving ? 'Saving…' : continueLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselected = searchParams.get('plan') as PlanId | null;
  const validPreselect = preselected && PUBLIC_PLANS.some((p) => p.id === preselected) ? preselected : null;
  const checkoutStatus = searchParams.get('checkout');
  const checkoutCancelled = checkoutStatus === 'cancelled';
  // Set when landing back here from Stripe Connect's hosted onboarding
  // (see /api/stripe/connect/return) — 'connected' | 'refresh' | 'error'.
  const stripeReturnStatus = searchParams.get('stripe');

  const [currentStep, setCurrentStep] = useState(
    stripeReturnStatus ? 5 : validPreselect === 'starter' ? 2 : 1
  );
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(
    validPreselect === 'starter' ? validPreselect : null
  );
  const [checkoutRedirecting, setCheckoutRedirecting] = useState(false);
  // Set while we're polling to confirm a just-completed Stripe Checkout's
  // webhook has actually landed the paid plan before letting onboarding's
  // own PATCH /api/auth/me calls touch user_metadata -- see
  // waitForPlanActivation below and the race documented in
  // lib/userMetadata.ts.
  const [confirmingPlan, setConfirmingPlan] = useState(false);

  // Steps 2, 3, 4: account settings — same fields/defaults as the
  // Settings page (src/app/dashboard/settings/page.tsx).
  const [fullName, setFullName] = useState('');
  const [defaultFlatFee, setDefaultFlatFee] = useState('400');
  const [defaultPercentFee, setDefaultPercentFee] = useState('0');
  const [invoiceDueDays, setInvoiceDueDays] = useState('30');
  const [isSavingStep, setIsSavingStep] = useState(false);
  const [stepError, setStepError] = useState('');

  // Step 5: checklist templates (informational — building one is still
  // done from Settings, not inline here).
  const [templates, setTemplates] = useState<
    { id: string; name: string; steps: { name: string; dueDate?: { mode: string } | null }[]; isBaseline: boolean }[]
  >([]);
  const [canUseCustomTemplates, setCanUseCustomTemplates] = useState(false);
  const [dueDateWorkflowEnabled, setDueDateWorkflowEnabled] = useState(false);
  const [dueDateWorkflowSteps, setDueDateWorkflowSteps] = useState<{ name: string; dueDate: DueDateSpec }[]>([]);

  // Step 6: how they get paid by agents.
  const [paymentPreference, setPaymentPreference] = useState<'stripe' | 'manual' | null>(null);
  const [isStartingStripeConnect, setIsStartingStripeConnect] = useState(false);
  const [stripeConnectStatus, setStripeConnectStatus] = useState<{ connected: boolean; status: string | null } | null>(
    null
  );
  const [isSavingPaymentPreference, setIsSavingPaymentPreference] = useState(false);
  const [paymentStepError, setPaymentStepError] = useState<string | null>(null);

  const startCheckout = async (planId: 'pro' | 'team' | 'brokerage') => {
    setCheckoutRedirecting(true);
    try {
      const res = await authFetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start checkout');
      window.location.href = data.url;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        clearSession();
        router.push('/auth');
        return;
      }
      console.error('Error starting checkout:', error);
      setCheckoutRedirecting(false);
      setCurrentStep(1);
      setSelectedPlan(null);
    }
  };

  const fetchPaymentStatus = async () => {
    try {
      const res = await authFetch('/api/stripe/connect/account');
      const data = await res.json();
      if (res.ok) {
        setStripeConnectStatus({ connected: data.connected, status: data.status });
        setPaymentPreference(data.paymentPreference || null);
      }
    } catch {
      // Non-fatal — the payment step just shows both options fresh.
    }
  };

  // Returns the account's current plan (or null if the fetch failed) so
  // the mount effect below can decide whether plan selection is even
  // still needed -- see its use there.
  const fetchProfile = async (): Promise<PlanId | null> => {
    try {
      const res = await authFetch('/api/auth/me');
      if (!res.ok) return null;
      const data = await res.json();
      setFullName(data.fullName ?? '');
      setDefaultFlatFee(String(data.defaultFlatFee ?? 400));
      setDefaultPercentFee(String(data.defaultPercentFee ?? 0));
      setInvoiceDueDays(String(data.invoiceDueDays ?? 30));
      setDueDateWorkflowEnabled(data.dueDateWorkflowEnabled === true);
      if (Array.isArray(data.dueDateWorkflowSteps)) {
        setDueDateWorkflowSteps(
          data.dueDateWorkflowSteps.map((s: { name: string; dueDate?: unknown }) => ({
            name: s.name,
            dueDate: normalizeDueDateSpec(s.dueDate),
          }))
        );
      }
      return PLANS.some((p) => p.id === data.plan) ? (data.plan as PlanId) : null;
    } catch {
      // Non-fatal — steps just start from their defaults.
      return null;
    }
  };

  // The Stripe webhook that grants a paid plan runs fully async, decoupled
  // from this redirect back from Checkout -- if onboarding trusts the
  // `plan` URL param and immediately lets its own PATCH /api/auth/me calls
  // (steps 2/3/4, fired as soon as someone clicks Continue) touch
  // user_metadata, one of them can read-modify-write a split second before
  // the webhook's own write lands, silently clobbering the plan the
  // customer just paid for back to whatever it was before (this is the
  // exact race lib/userMetadata.ts's mergeUserMetadata shrinks but can't
  // fully close -- see the comment there). Poll here until the plan has
  // actually taken effect server-side before advancing past this point, so
  // no onboarding PATCH is in flight while the webhook might still be
  // mid-write.
  const waitForPlanActivation = async (targetPlan: PlanId) => {
    setConfirmingPlan(true);
    const maxAttempts = 15;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const plan = await fetchProfile();
      if (plan === targetPlan) {
        setConfirmingPlan(false);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    // Gave it 15 seconds and the webhook still hasn't landed -- proceed
    // anyway rather than trapping the user on a spinner forever. Worst
    // case they land on step 2 before the plan has synced, same exposure
    // as before this fix existed, just far less likely.
    setConfirmingPlan(false);
  };

  const updateDueDateWorkflowStep = (index: number, dueDate: DueDateSpec) => {
    setDueDateWorkflowSteps((prev) => prev.map((s, i) => (i === index ? { ...s, dueDate } : s)));
  };

  const fetchTemplates = async () => {
    try {
      const res = await authFetch('/api/checklist-templates');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.templates)) setTemplates(data.templates);
      setCanUseCustomTemplates(Boolean(data.customChecklists));
    } catch {
      // Non-fatal — step 5 just shows the baseline only.
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      router.push('/auth');
      return;
    }

    fetchTemplates();

    (async () => {
      // Awaited before any of the branches below run, so they can tell
      // whether this account already has a paid plan.
      const existingPlan = await fetchProfile();

      // Returning from a completed Stripe Checkout — the webhook has already
      // (or is about to) grant the plan, so move on to the rest of the
      // walkthrough rather than sending them back through checkout again.
      if (checkoutStatus === 'success' && validPreselect) {
        await waitForPlanActivation(validPreselect);
        setSelectedPlan(validPreselect);
        setCurrentStep(2);
        return;
      }

      // Checkout was cancelled — land back on plan selection, don't re-fire
      // another checkout redirect automatically.
      if (checkoutStatus === 'cancelled') {
        setCurrentStep(1);
        return;
      }

      // Landing back here from Stripe Connect's hosted onboarding (see
      // /api/stripe/connect/return) — jump straight back to the payment
      // step (5) so it shows whatever actually happened (connected, needs a
      // fresh link, or errored) instead of restarting the whole walkthrough.
      if (stripeReturnStatus) {
        setCurrentStep(5);
        fetchPaymentStatus();
        if (stripeReturnStatus === 'refresh') {
          setPaymentStepError("That link expired before you finished — click Connect Stripe to get a new one.");
        } else if (stripeReturnStatus === 'error') {
          setPaymentStepError('Something went wrong connecting Stripe. Please try again.');
        }
        return;
      }

      // This account already has a paid plan by the time onboarding loads
      // -- most commonly a teammate who just signed up off a Team invite
      // (see POST /api/auth/signup and POST /api/team), which grants Team
      // access immediately since seats are pre-paid by the team owner.
      // Sending them through "choose a plan" here would let them pick
      // Pro/Team again and get bounced into a real Stripe Checkout for a
      // plan they're already on. Skip straight past plan selection.
      if (existingPlan === 'pro' || existingPlan === 'team' || existingPlan === 'brokerage') {
        setSelectedPlan(existingPlan);
        setCurrentStep(2);
        return;
      }

      // Arrived fresh with a plan already chosen on the pricing page. Starter
      // starts a free trial with no payment collected upfront (see
      // lib/trial.ts) -- nothing to do here, it's the default until someone
      // upgrades or their trial ends. Pro/Team need actual payment, so send
      // them straight to Stripe Checkout rather than granting the plan for
      // free.
      if (validPreselect === 'pro' || validPreselect === 'team' || validPreselect === 'brokerage') {
        startCheckout(validPreselect);
        return;
      }
      // validPreselect === 'starter', or nothing at all -- the initial
      // state (currentStep/selectedPlan set from the URL above) already
      // handles both, no further action needed.
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Stripe Connect form opens in another tab, so when this tab regains
  // focus on the payment step, re-check whether they finished.
  useEffect(() => {
    if (currentStep !== 5) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchPaymentStatus();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [currentStep]);

  const handleSelectPlan = (planId: PlanId) => {
    setSelectedPlan(planId);
    if (planId === 'starter') {
      setCurrentStep(2);
    } else {
      startCheckout(planId);
    }
  };

  const savePatch = async (patch: Record<string, unknown>, next: number) => {
    setIsSavingStep(true);
    setStepError('');
    try {
      const res = await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setCurrentStep(next);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        clearSession();
        router.push('/auth');
        return;
      }
      setStepError(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setIsSavingStep(false);
    }
  };

  const handleSaveProfile = () => savePatch({ fullName }, 3);

  const handleSaveFeesAndInvoicing = () => {
    const flat = parseFloat(defaultFlatFee);
    const pct = parseFloat(defaultPercentFee);
    const days = parseInt(invoiceDueDays, 10);
    if (defaultFlatFee.trim() !== '' && (Number.isNaN(flat) || flat < 0)) {
      setStepError('Flat fee must be 0 or more.');
      return;
    }
    if (defaultPercentFee.trim() !== '' && (Number.isNaN(pct) || pct < 0 || pct > 100)) {
      setStepError('Percentage fee must be between 0 and 100.');
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setStepError('Enter a number of days between 1 and 365.');
      return;
    }
    savePatch({ defaultFlatFee: flat || 0, defaultPercentFee: pct || 0, invoiceDueDays: days }, 4);
  };

  const handleSaveDueDateWorkflow = () => savePatch({ dueDateWorkflowEnabled, dueDateWorkflowSteps }, 5);

  // Moves between steps and clears any error left over from another step.
  const goTo = (step: number) => {
    setStepError('');
    setPaymentStepError(null);
    setCurrentStep(step);
  };

  const handleConnectStripe = async () => {
    setIsStartingStripeConnect(true);
    setPaymentStepError(null);
    try {
      const res = await authFetch('/api/stripe/connect/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'onboarding' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start Stripe Connect');
      // Opens in a new tab -- this is a one-time, single-use link, so
      // reusing this tab would strand the onboarding wizard the TC was
      // already on. Unlike a same-tab redirect, this page stays mounted,
      // so the button needs to reset itself rather than relying on
      // navigation to unmount it.
      window.open(data.url, '_blank', 'noopener,noreferrer');
      setIsStartingStripeConnect(false);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        clearSession();
        router.push('/auth');
        return;
      }
      setPaymentStepError(error instanceof Error ? error.message : 'Failed to start Stripe Connect');
      setIsStartingStripeConnect(false);
    }
  };

  const handleChooseManual = async () => {
    setIsSavingPaymentPreference(true);
    setPaymentStepError(null);
    try {
      const res = await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentPreference: 'manual' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save payment preference');
      }
      setPaymentPreference('manual');
      setCurrentStep(6);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        clearSession();
        router.push('/auth');
        return;
      }
      setPaymentStepError(error instanceof Error ? error.message : 'Failed to save payment preference');
    } finally {
      setIsSavingPaymentPreference(false);
    }
  };

  const handleCompleteSetup = async (destination: string = '/dashboard') => {
    // Marks the account so DashboardLayout never routes it back through
    // onboarding again, regardless of whether they've added an agent yet
    // -- see lib/onboarding.ts. Best-effort: if this save fails they just
    // see the wizard once more next time they sign in, which is harmless.
    //
    // Every exit from this final step -- not just "Go to Dashboard" but
    // also the three shortcut links above it -- must go through here, or
    // onboarding_completed never gets set and DashboardLayout bounces the
    // user straight back to onboarding the moment they land on whichever
    // page the shortcut sent them to.
    try {
      await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboardingCompleted: true }),
      });
    } catch {
      // ignore -- see comment above
    }
    router.push(destination);
  };

  const handleNumberChange =
    (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => setter(e.target.value);
  const blurOnWheel = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

  if (checkoutRedirecting || confirmingPlan) {
    return (
      <div className="min-h-screen app-bg flex items-center justify-center p-4">
        <div className="text-center" role="status" aria-live="polite">
          <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-300">
            {checkoutRedirecting ? 'Taking you to secure checkout…' : 'Finishing up your payment…'}
          </p>
        </div>
      </div>
    );
  }

  // A teammate who joined a Team (or a Pro/Team customer returning from
  // Checkout) already has their plan, so Back from the first settings step
  // must not reopen plan selection -- that would let them pick a plan again
  // and get bounced into a second Stripe Checkout.
  const canChangePlan = selectedPlan === null || selectedPlan === 'starter';
  const planName = PLANS.find((p) => p.id === selectedPlan)?.name || 'Starter';
  const showPlanStep = currentStep === 1;

  const launchItems: { title: string; body: string; cta: string; href: string; show?: boolean }[] = [
    {
      title: 'Start a deal from a contract',
      body: 'Upload the contract and Relay fills in the parties, dates and price, then builds your checklist.',
      cta: 'New transaction',
      href: '/dashboard/transactions/new',
    },
    {
      title: 'Add your agents',
      body:
        selectedPlan === 'starter'
          ? 'Each agent gets their own portal for deals, documents, messages and invoices. Starter includes up to 3.'
          : 'Each agent gets their own portal for deals, documents, messages and invoices.',
      cta: 'Add agents',
      href: '/dashboard/agents',
    },
    {
      title: 'Import your contacts',
      body: 'Bring in a CSV. Relay flags duplicates and keeps follow-up reminders on every contact.',
      cta: 'Open contacts',
      href: '/dashboard/contacts',
    },
    {
      title: 'Bring in deals you already have',
      body: 'Import open files from a CSV so your calendar and checklists start full.',
      cta: 'Import deals',
      href: '/dashboard/transactions/import',
    },
    {
      title: 'Put key dates on your calendar',
      body: 'Subscribe to your Relay calendar link in Google, Outlook or Apple Calendar.',
      cta: 'Get calendar link',
      href: '/dashboard/calendar',
    },
    {
      title: 'Track a listing',
      body: 'Log offers and showings, then convert the winning offer to a deal in one click.',
      cta: 'Open listings',
      href: '/dashboard/listings',
    },
    {
      title: 'Connect QuickBooks',
      body: 'Import and export invoices so your books stay in sync.',
      cta: 'Connect QuickBooks',
      href: '/dashboard/invoices/quickbooks',
    },
    {
      title: 'Invite your team',
      body: 'Share agents, transactions and contacts with teammates, and message them in Collaborate.',
      cta: 'Open Collaborate',
      href: '/dashboard/collaborate',
      show: selectedPlan === 'team' || selectedPlan === 'brokerage',
    },
  ].filter((i) => i.show !== false);

  return (
    <div className="min-h-screen app-bg text-slate-100">
      <header className="border-b border-white/10 bg-slate-950/40 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 bg-white rounded-lg flex items-center justify-center p-1.5 shadow-sm">
              <img src="/relay-icon.png" alt="" className="w-full h-full object-contain" />
            </span>
            <span className="font-display font-semibold text-slate-100">Relay TC</span>
          </div>
          <button
            type="button"
            onClick={() => {
              clearSession();
              router.push('/auth');
            }}
            className="text-sm text-slate-400 hover:text-slate-100 transition"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {checkoutCancelled && showPlanStep && (
          <div className="max-w-3xl mx-auto mb-8 p-4 bg-white/5 border border-white/10 rounded-2xl text-slate-300 text-sm text-center">
            Checkout was cancelled — no charge was made. Pick a plan whenever you&apos;re ready.
          </div>
        )}

        <ProgressHeader current={currentStep} />

        {currentStep === 1 && (
          <div>
            <div className="text-center mb-10">
              <h1 className="text-3xl sm:text-4xl font-display font-semibold text-slate-100 mb-3">Choose your plan</h1>
              <p className="text-lg text-slate-400">
                Starter is free for 30 days. Upgrade to Pro or Team any time from your Account page.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {PUBLIC_PLANS.map((plan) => (
                <div
                  key={plan.id}
                  className={`flex flex-col rounded-2xl border ${
                    plan.popular ? 'border-blue-500/70 bg-white/10 ring-1 ring-blue-500/30' : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div className="h-9 px-6 flex items-center">
                    {plan.popular ? (
                      <span className="text-xs font-semibold uppercase tracking-wide text-blue-300">Most popular</span>
                    ) : plan.trial ? (
                      <span className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                        {plan.trial.days}-day free trial
                      </span>
                    ) : null}
                  </div>
                  <div className="px-6 pb-6 flex flex-col flex-1">
                    <h2 className="text-2xl font-display font-semibold text-slate-100 mb-1">{plan.name}</h2>
                    <p className="text-slate-400 text-sm mb-5">{plan.description}</p>
                    <div className="mb-5">
                      <span className="text-4xl font-display font-semibold text-slate-100">{plan.price}</span>
                      <span className="text-slate-400 ml-1.5">{plan.period}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectPlan(plan.id)}
                      className={`w-full py-3 rounded-xl font-semibold transition mb-6 ${
                        plan.popular
                          ? 'bg-blue-500 hover:bg-blue-400 text-white'
                          : 'border border-slate-600 text-slate-200 hover:border-slate-500 hover:bg-white/5'
                      }`}
                    >
                      {plan.id === 'starter' ? 'Start free trial' : 'Continue to payment'}
                    </button>
                    <ul className="space-y-3">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2.5">
                          <svg className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          <span className="text-slate-300 text-sm">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <StepShell
            title="Tell us who you are"
            description="Your name appears to agents on invoices and emails, and to teammates on your Collaborate roster."
            saving={isSavingStep}
            error={stepError}
            onBack={canChangePlan ? () => goTo(1) : undefined}
            onContinue={handleSaveProfile}
          >
            <label htmlFor="ob-name" className="text-sm text-slate-400 block mb-2">
              Full name
            </label>
            <input
              id="ob-name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Smith"
              className={inputClass}
            />
          </StepShell>
        )}

        {currentStep === 3 && (
          <StepShell
            title="Fees and invoicing"
            description="These pre-fill every new agent and invoice. You can change them for any individual agent or invoice later."
            saving={isSavingStep}
            error={stepError}
            onBack={() => goTo(2)}
            onContinue={handleSaveFeesAndInvoicing}
          >
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="ob-flat" className="text-sm text-slate-400 block mb-2">
                  Flat fee per deal ($)
                </label>
                <MoneyInput
                  id="ob-flat"
                  value={defaultFlatFee}
                  onValueChange={setDefaultFlatFee}
                  placeholder="400"
                  aria-label="Default flat fee per deal"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="ob-pct" className="text-sm text-slate-400 block mb-2">
                  Percentage fee (%)
                </label>
                <input
                  id="ob-pct"
                  type="number"
                  value={defaultPercentFee}
                  onChange={handleNumberChange(setDefaultPercentFee)}
                  onWheel={blurOnWheel}
                  placeholder="0"
                  step="0.01"
                  min="0"
                  max="100"
                  className={inputClass}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">Leave the percentage at 0 if you only charge a flat fee.</p>

            <div className="border-t border-white/10 mt-6 pt-6">
              <label htmlFor="ob-due" className="text-sm text-slate-400 block mb-2">
                Invoices are due in (days)
              </label>
              <input
                id="ob-due"
                type="number"
                value={invoiceDueDays}
                onChange={handleNumberChange(setInvoiceDueDays)}
                onWheel={blurOnWheel}
                placeholder="30"
                step="1"
                min="1"
                max="365"
                className={`${inputClass} max-w-[10rem]`}
              />
            </div>
          </StepShell>
        )}

        {currentStep === 4 && (
          <StepShell
            title="Your deal checklist"
            description="Every deal starts from a checklist. Choose whether Relay should set due dates for you."
            badge={canUseCustomTemplates ? 'Pro / Team' : undefined}
            saving={isSavingStep}
            error={stepError}
            onBack={() => goTo(3)}
            onContinue={handleSaveDueDateWorkflow}
          >
            <div className="space-y-3">
              <div className="bg-slate-900/40 border border-white/10 rounded-xl px-4 py-3">
                <div className="flex items-center justify-between gap-4 mb-1.5">
                  <p className="text-slate-100 font-medium text-sm">Baseline checklist</p>
                  <p className="text-slate-500 text-xs shrink-0">6 steps · included on every plan</p>
                </div>
                <p className="text-slate-400 text-xs leading-relaxed">
                  Contract &amp; File Setup → Earnest Money &amp; Option → Inspection &amp; Repairs → Title, Appraisal
                  &amp; Financing → Clear to Close → Closing &amp; Post-Closing.
                </p>
              </div>

              <div className="bg-slate-900/40 border border-white/10 rounded-xl px-4 py-3">
                <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dueDateWorkflowEnabled}
                    onChange={(e) => setDueDateWorkflowEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  Set due dates automatically for each step
                </label>
                <p className="text-xs text-slate-500 mt-1.5 mb-1">
                  Off means no step gets a due date unless you add one. Due dates feed your calendar and reminder
                  emails. You can change any step on a single deal, or this whole setup, later in Settings.
                </p>
                {dueDateWorkflowEnabled && (
                  <div className="space-y-2 mt-3">
                    {dueDateWorkflowSteps.map((step, index) => (
                      <div key={step.name} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-slate-300 text-xs">{step.name}</span>
                        <DueDateControl
                          value={step.dueDate}
                          onChange={(next) => updateDueDateWorkflowStep(index, next)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {templates
                .filter((t) => !t.isBaseline)
                .map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center justify-between gap-4 bg-slate-900/40 border border-white/10 rounded-xl px-4 py-3"
                  >
                    <p className="text-slate-100 font-medium text-sm">{template.name}</p>
                    <p className="text-slate-500 text-xs">{template.steps.length} steps</p>
                  </div>
                ))}

              {!canUseCustomTemplates ? (
                <p className="text-sm text-slate-400 bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                  Pro and Team can build their own checklist templates with custom steps, order, required-step flags
                  and due-date rules, then pick one for each deal. Upgrade any time from the Account page.
                </p>
              ) : (
                <p className="text-sm text-slate-400">Build your own templates any time in Settings. No need to do it now.</p>
              )}
            </div>
          </StepShell>
        )}

        {currentStep === 5 && (
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-display font-semibold text-slate-100 mb-2">How do agents pay you?</h1>
              <p className="text-slate-400">You can change this any time in Settings.</p>
            </div>

            {paymentStepError && (
              <div role="alert" className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-xl text-sm text-red-200 text-center">
                {paymentStepError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 sm:p-8 flex flex-col">
                <h2 className="text-xl font-display font-semibold text-slate-100 mb-2">Get paid through Relay</h2>
                <p className="text-slate-400 text-sm mb-6 flex-1">
                  Connect a Stripe account and every invoice gets a payment link. Agents pay by card or bank transfer
                  without creating an account, and the money goes straight to your own Stripe account. It opens in a
                  new tab.
                </p>
                {stripeConnectStatus?.status === 'approved' ? (
                  <div>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-900/30 text-green-300 border border-green-700/50 mb-4">
                      Connected &amp; ready
                    </span>
                    <button
                      type="button"
                      onClick={() => goTo(6)}
                      className="w-full py-3 rounded-xl font-semibold transition bg-blue-500 hover:bg-blue-400 text-white"
                    >
                      Continue
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={handleConnectStripe}
                      disabled={isStartingStripeConnect}
                      className="w-full py-3 rounded-xl font-semibold transition bg-blue-500 hover:bg-blue-400 text-white disabled:opacity-50"
                    >
                      {isStartingStripeConnect
                        ? 'Opening…'
                        : stripeConnectStatus?.connected
                        ? 'Finish connecting Stripe'
                        : 'Connect Stripe'}
                    </button>
                    {stripeConnectStatus?.connected && (
                      <button
                        type="button"
                        onClick={fetchPaymentStatus}
                        className="w-full text-sm text-slate-400 hover:text-slate-200 transition"
                      >
                        I finished in Stripe — check again
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 sm:p-8 flex flex-col">
                <h2 className="text-xl font-display font-semibold text-slate-100 mb-2">I&apos;ll collect payment myself</h2>
                <p className="text-slate-400 text-sm mb-6 flex-1">
                  Agents pay you by Zelle, Venmo, PayPal, check, or however you already work. Relay still builds the
                  invoice, emails it, tracks what&apos;s unpaid, and exports to QuickBooks. You mark it paid when the
                  money arrives.
                </p>
                <button
                  type="button"
                  onClick={handleChooseManual}
                  disabled={isSavingPaymentPreference}
                  className="w-full py-3 rounded-xl font-semibold transition border border-slate-600 text-slate-200 hover:border-slate-500 hover:bg-white/5 disabled:opacity-50"
                >
                  {isSavingPaymentPreference ? 'Saving…' : 'Collect it myself'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-center gap-6">
              <button type="button" onClick={() => goTo(4)} className="text-sm text-slate-400 hover:text-slate-200 transition">
                ← Back
              </button>
              <button type="button" onClick={() => goTo(6)} className="text-sm text-slate-400 hover:text-slate-200 transition">
                Decide later →
              </button>
            </div>
          </div>
        )}

        {currentStep === 6 && (
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <h1 className="text-3xl sm:text-4xl font-display font-semibold text-slate-100 mb-2">
                You&apos;re set up{fullName.trim() ? `, ${fullName.trim().split(' ')[0]}` : ''}
              </h1>
              <p className="text-slate-400">
                You&apos;re on the {planName} plan. Pick where to start — everything here is also in the menu.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {launchItems.map((item, i) => (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => handleCompleteSetup(item.href)}
                  className={`text-left rounded-2xl border p-5 transition group ${
                    i === 0
                      ? 'border-blue-500/60 bg-blue-500/10 hover:bg-blue-500/15'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <h2 className="text-base font-semibold text-slate-100 mb-1">{item.title}</h2>
                  <p className="text-sm text-slate-400 mb-3">{item.body}</p>
                  <span className="text-sm font-semibold text-blue-300 group-hover:text-blue-200">{item.cta} →</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 mt-8">
              <button
                type="button"
                onClick={() => goTo(5)}
                className="px-5 py-2.5 border border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100 rounded-xl font-semibold transition"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => handleCompleteSetup()}
                className="flex-1 px-5 py-2.5 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-xl transition"
              >
                Go to dashboard
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingContent />
    </Suspense>
  );
}
