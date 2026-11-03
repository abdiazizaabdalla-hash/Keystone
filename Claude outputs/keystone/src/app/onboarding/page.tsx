'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authFetch, AuthRequiredError, clearSession } from '@/lib/authClient';

import { PLANS, type PlanId } from '@/lib/plans';

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselected = searchParams.get('plan') as PlanId | null;
  const validPreselect = preselected && PLANS.some((p) => p.id === preselected) ? preselected : null;
  const checkoutStatus = searchParams.get('checkout');
  const checkoutCancelled = checkoutStatus === 'cancelled';
  // Set when landing back here from Stripe Connect's hosted onboarding
  // (see /api/stripe/connect/return) — 'connected' | 'refresh' | 'error'.
  const stripeReturnStatus = searchParams.get('stripe');

  // Step 1: choose plan. Step 2: choose how agents pay you (Stripe Connect
  // or handle it yourself). Step 3: setup guide.
  const [currentStep, setCurrentStep] = useState(
    validPreselect === 'starter' || stripeReturnStatus ? 2 : 1
  );
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(
    // Don't jump straight past plan selection for a paid plan until
    // checkout is actually confirmed — starting on step 1 (with the plan
    // pre-highlighted via the redirect below) avoids showing "You're on
    // the Pro plan" for a split second before payment has even happened.
    validPreselect === 'starter' ? validPreselect : null
  );
  const [checkoutRedirecting, setCheckoutRedirecting] = useState(false);

  // Step 2 (payment method) state.
  const [paymentPreference, setPaymentPreference] = useState<'stripe' | 'manual' | null>(null);
  const [isStartingStripeConnect, setIsStartingStripeConnect] = useState(false);
  const [stripeConnectStatus, setStripeConnectStatus] = useState<{ connected: boolean; status: string | null } | null>(
    null
  );
  const [isSavingPaymentPreference, setIsSavingPaymentPreference] = useState(false);
  const [paymentStepError, setPaymentStepError] = useState<string | null>(null);

  const startCheckout = async (planId: 'pro' | 'team') => {
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
      // Non-fatal — step 2 just falls back to showing both options fresh.
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      router.push('/auth');
      return;
    }

    // Returning from a completed Stripe Checkout — the webhook has already
    // (or is about to) grant the plan, so move on to the payment-method
    // step rather than sending them back through checkout again.
    if (checkoutStatus === 'success' && validPreselect) {
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
    // /api/stripe/connect/return) — refresh status so step 2 shows
    // whatever actually happened (connected, needs a fresh link, or
    // errored) instead of the stale pre-redirect state.
    if (stripeReturnStatus) {
      setCurrentStep(2);
      fetchPaymentStatus();
      if (stripeReturnStatus === 'refresh') {
        setPaymentStepError("That link expired before you finished — click Connect Stripe to get a new one.");
      } else if (stripeReturnStatus === 'error') {
        setPaymentStepError('Something went wrong connecting Stripe. Please try again.');
      }
      return;
    }

    // Arrived fresh with a plan already chosen on the pricing page. Starter
    // starts a free trial with no payment collected upfront (see
    // lib/trial.ts) -- nothing to do here, it's the default until someone
    // upgrades or their trial ends. Pro/Team need actual payment, so send
    // them straight to Stripe Checkout rather than granting the plan for
    // free.
    if (validPreselect === 'pro' || validPreselect === 'team') {
      startCheckout(validPreselect);
      return;
    }

    // Landed straight on step 2 (e.g. Starter preselected) — load whatever
    // payment preference/status already exists so a returning user doesn't
    // see the choice screen reset every time.
    if (validPreselect === 'starter') {
      fetchPaymentStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectPlan = (planId: PlanId) => {
    setSelectedPlan(planId);
    if (planId === 'starter') {
      setCurrentStep(2);
      fetchPaymentStatus();
    } else {
      startCheckout(planId);
    }
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
      window.location.href = data.url;
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
      setCurrentStep(3);
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

  const handleCompleteSetup = () => {
    router.push('/dashboard');
  };

  if (checkoutRedirecting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-ink-950 to-ink-900 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-ink-700 border-t-amber-400 animate-spin mx-auto mb-4" />
          <p className="text-ink-300">Taking you to secure checkout…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-ink-950 to-ink-900">
      {/* Header */}
      <div className="border-b border-ink-800 bg-ink-900/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/relay-icon.png" alt="Relay TC" className="w-10 h-10 object-contain" />
            <h1 className="text-xl font-display font-semibold text-ink-100">Relay TC</h1>
          </div>
          <button
            onClick={() => {
              clearSession();
              router.push('/auth');
            }}
            className="text-sm text-ink-400 hover:text-ink-100"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        {checkoutCancelled && (
          <div className="max-w-3xl mx-auto mb-8 p-4 bg-ink-800/50 border border-ink-700 rounded-lg text-ink-300 text-sm text-center">
            Checkout was cancelled — no charge was made. Pick a plan below whenever you&apos;re ready.
          </div>
        )}
        {currentStep === 1 ? (
          // Step 1: Choose Plan
          <div>
            <div className="text-center mb-12">
              <h2 className="text-4xl font-display font-semibold text-ink-100 mb-4">Choose your plan</h2>
              <p className="text-xl text-ink-400">
                Select the plan that fits your transaction coordinator business
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {PLANS.map((plan) => (
                <div
                  key={plan.id}
                  className={`rounded-lg border transition ${
                    plan.popular
                      ? 'border-amber-500 bg-ink-800 ring-2 ring-amber-500/20'
                      : 'border-ink-700 bg-ink-800/50 hover:border-ink-600'
                  }`}
                >
                  {plan.popular && (
                    <div className="bg-amber-500/10 border-b border-amber-500 px-6 py-2">
                      <span className="text-sm font-semibold text-amber-400">Most Popular</span>
                    </div>
                  )}

                  <div className="p-8">
                    <h3 className="text-2xl font-display font-semibold text-ink-100 mb-2">{plan.name}</h3>
                    <p className="text-ink-400 text-sm mb-6">{plan.description}</p>

                    <div className="mb-6">
                      <span className="text-4xl font-display font-semibold text-ink-100">{plan.price}</span>
                      <span className="text-ink-400 ml-2">{plan.period}</span>
                    </div>

                    <button
                      onClick={() => handleSelectPlan(plan.id)}
                      className={`w-full py-3 rounded-lg font-semibold transition mb-8 disabled:opacity-50 ${
                        plan.popular
                          ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-ink-950'
                          : 'border border-ink-600 text-ink-300 hover:border-ink-500 hover:text-ink-100'
                      }`}
                    >
                      {plan.id === 'starter' ? 'Select Plan' : `Continue to payment`}
                    </button>

                    <ul className="space-y-4">
                      {plan.features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          <span className="text-ink-300 text-sm">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : currentStep === 2 ? (
          // Step 2: How do you get paid by agents?
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-display font-semibold text-ink-100 mb-4">How do you get paid?</h2>
              <p className="text-xl text-ink-400">
                Choose how agents pay your transaction coordination fees. You can change this anytime in Settings.
              </p>
            </div>

            {paymentStepError && (
              <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-200 text-center">
                {paymentStepError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-8 flex flex-col">
                <h3 className="text-xl font-display font-semibold text-ink-100 mb-2">Get paid automatically</h3>
                <p className="text-ink-400 text-sm mb-6 flex-1">
                  Connect a Stripe account. Every invoice gets a real payment link — agents pay by card or bank
                  transfer without creating an account, and the money lands directly in your own Stripe account.
                  Relay never touches the funds.
                </p>
                {stripeConnectStatus?.status === 'approved' ? (
                  <div className="text-center">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-900/30 text-green-300 border border-green-700/50 mb-4">
                      Connected &amp; ready
                    </span>
                    <button
                      onClick={() => setCurrentStep(3)}
                      className="w-full py-3 rounded-lg font-semibold transition bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-ink-950"
                    >
                      Continue
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleConnectStripe}
                    disabled={isStartingStripeConnect}
                    className="w-full py-3 rounded-lg font-semibold transition bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-ink-950 disabled:opacity-50"
                  >
                    {isStartingStripeConnect
                      ? 'Opening...'
                      : stripeConnectStatus?.connected
                      ? 'Finish connecting Stripe'
                      : 'Connect Stripe'}
                  </button>
                )}
              </div>

              <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-8 flex flex-col">
                <h3 className="text-xl font-display font-semibold text-ink-100 mb-2">Handle it yourself</h3>
                <p className="text-ink-400 text-sm mb-6 flex-1">
                  Skip online payments — agents pay you directly through Zelle, Venmo, PayPal, a check, or however
                  you already work. Relay still generates invoices and tracks whether they&apos;re paid; you just
                  mark them paid yourself once you&apos;ve received the money. You can set up your Zelle details for
                  invoices in Settings.
                </p>
                <button
                  onClick={handleChooseManual}
                  disabled={isSavingPaymentPreference}
                  className="w-full py-3 rounded-lg font-semibold transition border border-ink-600 text-ink-300 hover:border-ink-500 hover:text-ink-100 disabled:opacity-50"
                >
                  {isSavingPaymentPreference && paymentPreference !== 'stripe' ? 'Saving...' : "I'll handle it myself"}
                </button>
              </div>
            </div>

            <div className="text-center">
              <button
                onClick={() => setCurrentStep(3)}
                className="text-sm text-ink-500 hover:text-ink-300"
              >
                Decide later — skip this step →
              </button>
            </div>
          </div>
        ) : (
          // Step 3: Setup Guide (Pro/Team land here after returning from a
          // successful Stripe Checkout via /dashboard/account)
          <div>
            <div className="text-center mb-12">
              <h2 className="text-4xl font-display font-semibold text-ink-100 mb-4">Set up your account</h2>
              <p className="text-xl text-ink-400">
                You&apos;re on the {PLANS.find((p) => p.id === selectedPlan)?.name || 'Starter'} plan. Let&apos;s get you set up!
              </p>
            </div>

            <div className="max-w-3xl mx-auto space-y-8">
              {/* Step 1: Add Agents */}
              <div className="bg-ink-800/50 border border-ink-700 rounded-lg p-8">
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-10 h-10 bg-amber-500/20 border border-amber-500 rounded-full flex items-center justify-center text-amber-400 font-bold">
                    1
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-ink-100 mb-2">Add Your Agents</h3>
                    <p className="text-ink-400 mb-4">
                      Start by adding the real estate agents you work with. Set their flat fees per transaction, and an optional percentage-based fee for agents who use one.
                    </p>
                    <Link
                      href="/dashboard/agents"
                      className="inline-block px-6 py-2 bg-amber-500 hover:bg-amber-600 text-ink-950 font-semibold rounded-lg transition"
                    >
                      Go to Agents →
                    </Link>
                  </div>
                </div>
              </div>

              {/* Step 2: Create Transactions */}
              <div className="bg-ink-800/50 border border-ink-700 rounded-lg p-8">
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-10 h-10 bg-amber-500/20 border border-amber-500 rounded-full flex items-center justify-center text-amber-400 font-bold">
                    2
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-ink-100 mb-2">Create Your First Transaction</h3>
                    <p className="text-ink-400 mb-4">
                      Add deals as you take them on. Track the property address, purchase price, and agent. Relay will automatically calculate fees and generate a checklist.
                    </p>
                    <Link
                      href="/dashboard/transactions/new"
                      className="inline-block px-6 py-2 bg-amber-500 hover:bg-amber-600 text-ink-950 font-semibold rounded-lg transition"
                    >
                      Create First Deal →
                    </Link>
                  </div>
                </div>
              </div>

              {/* Step 3: Manage Invoices */}
              <div className="bg-ink-800/50 border border-ink-700 rounded-lg p-8">
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-10 h-10 bg-amber-500/20 border border-amber-500 rounded-full flex items-center justify-center text-amber-400 font-bold">
                    3
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-ink-100 mb-2">Generate & Track Invoices</h3>
                    <p className="text-ink-400 mb-4">
                      When deals close, Relay generates invoices based on your flat fees and percentages. Track payments and mark them paid as they come in.
                    </p>
                    <Link
                      href="/dashboard/invoices"
                      className="inline-block px-6 py-2 bg-amber-500 hover:bg-amber-600 text-ink-950 font-semibold rounded-lg transition"
                    >
                      View Invoices →
                    </Link>
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex gap-4">
                <button
                  onClick={() => setCurrentStep(1)}
                  className="px-6 py-3 border border-ink-600 text-ink-300 hover:border-ink-500 hover:text-ink-100 rounded-lg font-semibold transition"
                >
                  ← Change Plan
                </button>
                <button
                  onClick={handleCompleteSetup}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-ink-950 font-semibold rounded-lg transition"
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
