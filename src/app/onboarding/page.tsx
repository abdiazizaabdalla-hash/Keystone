'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authFetch, AuthRequiredError, clearSession } from '@/lib/authClient';
import { DueDateSpec, normalizeDueDateSpec } from '@/lib/dueDates';
import DueDateControl from '@/components/DueDateControl';

import { PLANS, PUBLIC_PLANS, type PlanId } from '@/lib/plans';

// Onboarding walks a new account through every setting one step at a time
// before dropping them at the dashboard, instead of leaving Settings to be
// discovered later:
//   1. Choose plan
//   2. Your Profile (full name)
//   3. Agent Defaults (fee pre-fills)
//   4. Invoicing (due-in days)
//   5. Checklist Templates (info — Pro/Team can build their own later)
//   6. Getting Paid by Agents (Stripe Connect vs. handle it yourself)
//   7. Setup guide / finish
// Each settings step (2, 3, 4) saves immediately via PATCH /api/auth/me
// before advancing — the same endpoint and fields the Settings page itself
// uses — so someone who closes the tab partway through keeps whatever
// they already filled in instead of losing it.
const TOTAL_STEPS = 7;

const inputClass =
  'w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

// Shared shell for every settings step (2-6): a step counter, title,
// description, the step's own fields, an inline error, and Back/Continue
// controls. Defined at module scope (not inside OnboardingContent) so its
// identity is stable across renders — nesting a component definition
// inside another component's render body makes React remount it on every
// keystroke, which would knock focus out of these inputs as you type.
function SettingsStepShell({
  step,
  totalSteps,
  title,
  description,
  badge,
  children,
  onBack,
  onContinue,
  continueLabel = 'Continue',
  continueDisabled = false,
  saving,
  error,
}: {
  step: number;
  totalSteps: number;
  title: string;
  description: string;
  badge?: string;
  children: React.ReactNode;
  onBack: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  saving: boolean;
  error: string;
}) {
  return (
    <div className="max-w-2xl mx-auto">
      <p className="text-center text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">
        Step {step} of {totalSteps}
      </p>
      <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2 className="text-xl font-display font-semibold text-slate-100">{title}</h2>
          {badge && (
            <span className="inline-block px-2.5 py-1 bg-blue-500/20 border border-blue-500/50 text-blue-300 text-xs font-semibold rounded-full shrink-0">
              {badge}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-400 mb-6">{description}</p>

        {children}

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

        <div className="flex gap-3 mt-8">
          <button
            type="button"
            onClick={onBack}
            className="px-5 py-2.5 border border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100 rounded-lg font-semibold transition"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={onContinue}
            disabled={continueDisabled || saving}
            className="flex-1 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : continueLabel}
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
    stripeReturnStatus ? 6 : validPreselect === 'starter' ? 2 : 1
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
      // Non-fatal — step 7 just falls back to showing both options fresh.
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
      // step so it shows whatever actually happened (connected, needs a
      // fresh link, or errored) instead of restarting the whole walkthrough.
      if (stripeReturnStatus) {
        setCurrentStep(6);
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

  const handleSaveDueDateWorkflow = () => savePatch({ dueDateWorkflowEnabled, dueDateWorkflowSteps }, 6);

  const handleSaveAgentDefaults = () =>
    savePatch(
      { defaultFlatFee: parseFloat(defaultFlatFee) || 0, defaultPercentFee: parseFloat(defaultPercentFee) || 0 },
      4
    );

  const handleSaveInvoicing = () => savePatch({ invoiceDueDays: parseInt(invoiceDueDays, 10) || 30 }, 5);

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
      setCurrentStep(7);
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

  if (checkoutRedirecting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-300">Taking you to secure checkout…</p>
        </div>
      </div>
    );
  }

  if (confirmingPlan) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-300">Finishing up your payment…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      {/* Header */}
      <div className="border-b border-slate-700 bg-slate-800/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="w-10 h-10 bg-white rounded-lg flex items-center justify-center p-1.5 shadow-sm">
            <img src="/relay-icon.png" alt="Relay TC" className="w-full h-full object-contain" />
          </span>
          <button
            onClick={() => {
              clearSession();
              router.push('/auth');
            }}
            className="text-sm text-slate-400 hover:text-slate-100"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        {checkoutCancelled && (
          <div className="max-w-3xl mx-auto mb-8 p-4 bg-slate-700/50 border border-slate-600 rounded-lg text-slate-300 text-sm text-center">
            Checkout was cancelled — no charge was made. Pick a plan below whenever you&apos;re ready.
          </div>
        )}

        {currentStep === 1 && (
          // Step 1: Choose Plan
          <div>
            <div className="text-center mb-12">
              <h2 className="text-4xl font-display font-semibold text-slate-100 mb-4">Choose your plan</h2>
              <p className="text-xl text-slate-400">
                Select the plan that fits your transaction coordinator business
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {PUBLIC_PLANS.map((plan) => (
                <div
                  key={plan.id}
                  className={`rounded-lg border transition ${
                    plan.popular
                      ? 'border-blue-500 bg-slate-700 ring-2 ring-blue-500/20'
                      : 'border-slate-600 bg-slate-700/50 hover:border-slate-600'
                  }`}
                >
                  {plan.popular && (
                    <div className="bg-blue-500/10 border-b border-blue-500 px-6 py-2">
                      <span className="text-sm font-semibold text-blue-400">Most Popular</span>
                    </div>
                  )}

                  <div className="p-8">
                    <h3 className="text-2xl font-display font-semibold text-slate-100 mb-2">{plan.name}</h3>
                    <p className="text-slate-400 text-sm mb-6">{plan.description}</p>

                    <div className="mb-6">
                      <span className="text-4xl font-display font-semibold text-slate-100">{plan.price}</span>
                      <span className="text-slate-400 ml-2">{plan.period}</span>
                    </div>

                    <button
                      onClick={() => handleSelectPlan(plan.id)}
                      className={`w-full py-3 rounded-lg font-semibold transition mb-8 disabled:opacity-50 ${
                        plan.popular
                          ? 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white'
                          : 'border border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100'
                      }`}
                    >
                      {plan.id === 'starter' ? 'Select Plan' : `Continue to payment`}
                    </button>

                    <ul className="space-y-4">
                      {plan.features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
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
          <SettingsStepShell
            step={2}
            totalSteps={TOTAL_STEPS}
            title="Your Profile"
            description="Shown to teammates on your Collaborate roster instead of your bare email address."
            saving={isSavingStep}
            error={stepError}
            onBack={() => setCurrentStep(1)}
            onContinue={handleSaveProfile}
          >
            <div>
              <label className="text-sm text-slate-400 block mb-2">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith"
                className={inputClass}
              />
            </div>
          </SettingsStepShell>
        )}

        {currentStep === 3 && (
          <SettingsStepShell
            step={3}
            totalSteps={TOTAL_STEPS}
            title="Agent Defaults"
            description="Pre-fills the fee fields whenever you add a new agent. You can still change these per agent."
            saving={isSavingStep}
            error={stepError}
            onBack={() => setCurrentStep(2)}
            onContinue={handleSaveAgentDefaults}
          >
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="text-sm text-slate-400 block mb-2">Default Flat Fee per Deal ($)</label>
                <input
                  type="number"
                  value={defaultFlatFee}
                  onChange={handleNumberChange(setDefaultFlatFee)}
                  onWheel={blurOnWheel}
                  placeholder="400"
                  step="0.01"
                  min="0"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-2">Default Percentage Fee (%)</label>
                <input
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
          </SettingsStepShell>
        )}

        {currentStep === 4 && (
          <SettingsStepShell
            step={4}
            totalSteps={TOTAL_STEPS}
            title="Invoicing"
            description="How many days an agent has to pay after an invoice is generated. You can still change the due date on any individual invoice afterward."
            saving={isSavingStep}
            error={stepError}
            onBack={() => setCurrentStep(3)}
            onContinue={handleSaveInvoicing}
          >
            <div className="max-w-xs">
              <label className="text-sm text-slate-400 block mb-2">Due in (days)</label>
              <input
                type="number"
                value={invoiceDueDays}
                onChange={handleNumberChange(setInvoiceDueDays)}
                onWheel={blurOnWheel}
                placeholder="30"
                step="1"
                min="1"
                max="365"
                className={inputClass}
              />
            </div>
          </SettingsStepShell>
        )}

        {currentStep === 5 && (
          <SettingsStepShell
            step={5}
            totalSteps={TOTAL_STEPS}
            title="Checklist Templates"
            description="Every deal starts from the Baseline checklist below for free. On Pro and Team, build your own checklist templates — add, remove, and reorder steps like widgets, each with its own due-date rule — and pick one per deal when you create it."
            badge={canUseCustomTemplates ? 'Pro / Team' : undefined}
            saving={isSavingStep}
            error={stepError}
            onBack={() => setCurrentStep(4)}
            onContinue={handleSaveDueDateWorkflow}
          >
            <div className="space-y-3">
              <div className="bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-3">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <p className="text-slate-100 font-medium text-sm">Baseline (default)</p>
                  <p className="text-slate-500 text-xs shrink-0">6 steps · always available</p>
                </div>
                <p className="text-slate-400 text-xs leading-relaxed">
                  Contract &amp; File Setup → Earnest Money &amp; Option → Inspection &amp; Repairs → Title, Appraisal
                  &amp; Financing → Clear to Close → Closing &amp; Post-Closing.
                </p>
              </div>

              <div className="bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-3">
                <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer mb-1">
                  <input
                    type="checkbox"
                    checked={dueDateWorkflowEnabled}
                    onChange={(e) => setDueDateWorkflowEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  Automatically calculate due dates for each step
                </label>
                <p className="text-xs text-slate-500 mb-3">
                  Off by default -- no due date is set for any step unless you turn this on. Either way, you can
                  change any single step&apos;s due date on an individual deal later, and fine-tune this whole
                  setup anytime from Settings.
                </p>
                {dueDateWorkflowEnabled && (
                  <div className="space-y-2">
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
                    className="flex items-center justify-between gap-4 bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-3"
                  >
                    <div>
                      <p className="text-slate-100 font-medium text-sm">{template.name}</p>
                      <p className="text-slate-500 text-xs">{template.steps.length} steps</p>
                    </div>
                  </div>
                ))}
              {!canUseCustomTemplates ? (
                <div className="bg-blue-900/10 border border-blue-800/40 rounded-lg p-4 text-sm text-blue-200/90">
                  Pro and Team accounts can customize their own workflow — build custom checklist templates with
                  your own steps, order, and due-date timing, and pick one per deal when you create it. You can
                  upgrade anytime from the Account page.
                </div>
              ) : (
                <p className="text-sm text-slate-400">
                  You can build your own templates anytime from Settings — no need to do it now.
                </p>
              )}
            </div>
          </SettingsStepShell>
        )}

        {currentStep === 6 && (
          // Getting Paid by Agents: Stripe Connect vs. handle it yourself.
          <div className="max-w-3xl mx-auto">
            <p className="text-center text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">
              Step {currentStep} of {TOTAL_STEPS}
            </p>
            <div className="text-center mb-12">
              <h2 className="text-4xl font-display font-semibold text-slate-100 mb-4">How do you get paid?</h2>
              <p className="text-xl text-slate-400">
                Choose how agents pay your transaction coordination fees. You can change this anytime in Settings.
              </p>
            </div>

            {paymentStepError && (
              <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-200 text-center">
                {paymentStepError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              <div className="rounded-lg border border-slate-600 bg-slate-700/50 p-8 flex flex-col">
                <h3 className="text-xl font-display font-semibold text-slate-100 mb-2">Get paid automatically</h3>
                <p className="text-slate-400 text-sm mb-6 flex-1">
                  Connect a Stripe account. Every invoice gets a real payment link — agents pay by card or bank
                  transfer without creating an account, and the money lands directly in your own Stripe account.
                </p>
                {stripeConnectStatus?.status === 'approved' ? (
                  <div className="text-center">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-900/30 text-green-300 border border-green-700/50 mb-4">
                      Connected &amp; ready
                    </span>
                    <button
                      onClick={() => setCurrentStep(7)}
                      className="w-full py-3 rounded-lg font-semibold transition bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white"
                    >
                      Continue
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleConnectStripe}
                    disabled={isStartingStripeConnect}
                    className="w-full py-3 rounded-lg font-semibold transition bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white disabled:opacity-50"
                  >
                    {isStartingStripeConnect
                      ? 'Opening...'
                      : stripeConnectStatus?.connected
                      ? 'Finish connecting Stripe'
                      : 'Connect Stripe'}
                  </button>
                )}
              </div>

              <div className="rounded-lg border border-slate-600 bg-slate-700/50 p-8 flex flex-col">
                <h3 className="text-xl font-display font-semibold text-slate-100 mb-2">Handle it yourself</h3>
                <p className="text-slate-400 text-sm mb-6 flex-1">
                  Skip online payments — agents pay you directly through Zelle, Venmo, PayPal, a check, or however
                  you already work. Relay still generates invoices and tracks whether they&apos;re paid; you just
                  mark them paid yourself once you&apos;ve received the money.
                </p>
                <button
                  onClick={handleChooseManual}
                  disabled={isSavingPaymentPreference}
                  className="w-full py-3 rounded-lg font-semibold transition border border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
                >
                  {isSavingPaymentPreference && paymentPreference !== 'stripe' ? 'Saving...' : "I'll handle it myself"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-center gap-6">
              <button onClick={() => setCurrentStep(5)} className="text-sm text-slate-500 hover:text-slate-300">
                ← Back
              </button>
              <button onClick={() => setCurrentStep(7)} className="text-sm text-slate-500 hover:text-slate-300">
                Decide later — skip this step →
              </button>
            </div>
          </div>
        )}

        {currentStep === 7 && (
          // Step 8: Setup Guide (finish)
          <div>
            <div className="text-center mb-12">
              <h2 className="text-4xl font-display font-semibold text-slate-100 mb-4">You&apos;re all set</h2>
              <p className="text-xl text-slate-400">
                You&apos;re on the {PLANS.find((p) => p.id === selectedPlan)?.name || 'Starter'} plan. Here&apos;s where to go next.
              </p>
            </div>

            <div className="max-w-3xl mx-auto space-y-8">
              {/* Step 1: Add Agents */}
              <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-8">
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-10 h-10 bg-blue-500/20 border border-blue-500 rounded-full flex items-center justify-center text-blue-400 font-bold">
                    1
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-slate-100 mb-2">Add Your Agents</h3>
                    <p className="text-slate-400 mb-4">
                      Start by adding the real estate agents you work with. Set their flat fees per transaction, and an optional percentage-based fee for agents who use one.
                    </p>
                    <button
                      onClick={() => handleCompleteSetup('/dashboard/agents')}
                      className="inline-block px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition"
                    >
                      Go to Agents →
                    </button>
                  </div>
                </div>
              </div>

              {/* Step 2: Create Transactions */}
              <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-8">
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-10 h-10 bg-blue-500/20 border border-blue-500 rounded-full flex items-center justify-center text-blue-400 font-bold">
                    2
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-slate-100 mb-2">Create Your First Transaction</h3>
                    <p className="text-slate-400 mb-4">
                      Add deals as you take them on. Track the property address, purchase price, and agent. Relay will automatically calculate fees and generate a checklist.
                    </p>
                    <button
                      onClick={() => handleCompleteSetup('/dashboard/transactions/new')}
                      className="inline-block px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition"
                    >
                      Create First Deal →
                    </button>
                  </div>
                </div>
              </div>

              {/* Step 3: Manage Invoices */}
              <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-8">
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-10 h-10 bg-blue-500/20 border border-blue-500 rounded-full flex items-center justify-center text-blue-400 font-bold">
                    3
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-slate-100 mb-2">Generate &amp; Track Invoices</h3>
                    <p className="text-slate-400 mb-4">
                      When deals close, Relay generates invoices based on your flat fees and percentages. Track payments and mark them paid as they come in.
                    </p>
                    <button
                      onClick={() => handleCompleteSetup('/dashboard/invoices')}
                      className="inline-block px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition"
                    >
                      View Invoices →
                    </button>
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex gap-4">
                <button
                  onClick={() => setCurrentStep(6)}
                  className="px-6 py-3 border border-slate-600 text-slate-300 hover:border-slate-500 hover:text-slate-100 rounded-lg font-semibold transition"
                >
                  ← Back
                </button>
                <button
                  onClick={() => handleCompleteSetup()}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition"
                >
                  Go to Dashboard →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
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
