'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { isValidPlan, planLabel } from '@/lib/plans';

function AuthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planParam = searchParams.get('plan');
  const plan = planParam && isValidPlan(planParam) ? planParam : null;

  const [isSignUp, setIsSignUp] = useState(searchParams.get('mode') === 'signup' || !!plan);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmationSentTo, setConfirmationSentTo] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isSignUp ? '/api/auth/signup' : '/api/auth/signin';
      const redirectTo = isSignUp
        ? `${window.location.origin}/auth/confirm${plan ? `?plan=${plan}` : ''}`
        : undefined;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(redirectTo ? { redirectTo } : {}),
          ...(isSignUp && fullName.trim() ? { fullName: fullName.trim() } : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Authentication failed');
        return;
      }

      // Store auth token (and refresh token, so the app can silently
      // refresh instead of forcing a re-login every time it expires)
      if (data.session?.access_token) {
        localStorage.setItem('auth_token', data.session.access_token);
        if (data.session?.refresh_token) {
          localStorage.setItem('refresh_token', data.session.refresh_token);
        }
        if (data.user?.id) {
          localStorage.setItem('user_id', data.user.id);
        }

        if (isSignUp) {
          // New accounts go through onboarding to pick/confirm a plan and
          // get set up, carrying along whatever plan they arrived with from
          // the pricing page.
          router.push(plan ? `/onboarding?plan=${plan}` : '/onboarding');
        } else {
          router.push('/dashboard');
        }
      } else if (isSignUp) {
        // Signup succeeded but Supabase requires email confirmation before
        // issuing a session (no session comes back yet). Tell the person
        // clearly instead of leaving the button looking like it did nothing.
        setConfirmationSentTo(email);
      } else {
        setError('Sign in failed. Please try again.');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col">
      {/* Minimal marketing nav */}
      <div className="px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="w-9 h-9 bg-white rounded-lg flex items-center justify-center p-1.5 shadow-sm">
              <img src="/relay-icon.png" alt="Relay TC" className="w-full h-full object-contain" />
            </span>
          </Link>
          <div className="flex items-center gap-6 text-sm text-slate-400">
            <Link href="/pricing" className="hover:text-slate-100 transition">Pricing</Link>
            <Link href="/faq" className="hover:text-slate-100 transition">FAQ</Link>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <span className="inline-block bg-white rounded-xl p-3 shadow-md mb-4">
              <img src="/relay-logo.png" alt="Relay TC" className="h-10 w-auto object-contain" />
            </span>
            <p className="text-slate-400 text-sm">Transaction Coordinator</p>
          </div>

          {/* Card */}
          <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
            {confirmationSentTo ? (
              <>
                <h2 className="text-2xl font-display font-semibold text-slate-100 mb-3">Check your email</h2>
                <p className="text-slate-300 text-sm mb-2">
                  We sent a confirmation link to <span className="text-slate-100 font-medium">{confirmationSentTo}</span>.
                </p>
                <p className="text-slate-400 text-sm mb-6">
                  Click the link to activate your account{plan ? ` and finish setting up your ${planLabel(plan)} plan` : ''}. You can close this tab.
                </p>
                <button
                  onClick={() => {
                    setConfirmationSentTo('');
                    setIsSignUp(false);
                  }}
                  className="text-blue-400 hover:text-blue-300 font-medium text-sm"
                >
                  Back to sign in
                </button>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-display font-semibold text-slate-100 mb-1">
                  {isSignUp ? 'Create Account' : 'Sign In'}
                </h2>
                {isSignUp && plan && (
                  <p className="text-sm text-blue-400 mb-5">Signing up for the {planLabel(plan)} plan</p>
                )}
                {!(isSignUp && plan) && <div className="mb-6" />}

                {error && (
                  <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  {isSignUp && (
                    <div>
                      <label className="text-sm text-slate-400 block mb-2">Full Name</label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Jane Smith"
                        className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-sm text-slate-400 block mb-2">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-sm text-slate-400 block mb-2">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50 mt-6"
                  >
                    {loading ? 'Processing...' : isSignUp ? 'Create Account' : 'Sign In'}
                  </button>
                </form>

                <div className="mt-6 pt-6 border-t border-slate-600 text-center">
                  <p className="text-slate-400 text-sm mb-3">
                    {isSignUp ? 'Already have an account?' : "Don't have an account?"}
                  </p>
                  <button
                    onClick={() => {
                      setIsSignUp(!isSignUp);
                      setError('');
                    }}
                    className="text-blue-400 hover:text-blue-300 font-medium text-sm"
                  >
                    {isSignUp ? 'Sign In' : 'Create Account'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={null}>
      <AuthContent />
    </Suspense>
  );
}
