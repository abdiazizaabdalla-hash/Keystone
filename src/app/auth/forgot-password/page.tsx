'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          redirectTo: `${window.location.origin}/auth/reset-password`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send reset email');
      // Shown regardless of whether the email is actually registered --
      // see the route's own comment on why it doesn't distinguish.
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col">
      <div className="px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="w-9 h-9 bg-white rounded-lg flex items-center justify-center p-1.5 shadow-sm">
              <img src="/relay-icon.png" alt="Relay TC" className="w-full h-full object-contain" />
            </span>
          </Link>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <span className="inline-block bg-white rounded-xl p-3 shadow-md mb-4">
              <img src="/relay-logo.png" alt="Relay TC" className="h-10 w-auto object-contain" />
            </span>
          </div>

          <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
            {sent ? (
              <>
                <h2 className="text-2xl font-display font-semibold text-slate-100 mb-3">Check your email</h2>
                <p className="text-slate-300 text-sm mb-6">
                  If an account exists for <span className="text-slate-100 font-medium">{email}</span>, we&apos;ve
                  sent a link to reset the password. It expires after a while, so use it soon.
                </p>
                <Link href="/auth" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
                  Back to sign in
                </Link>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-display font-semibold text-slate-100 mb-1">Reset your password</h2>
                <p className="text-slate-400 text-sm mb-6">
                  Enter the email on your account and we&apos;ll send you a link to set a new password.
                </p>

                {error && (
                  <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
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

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50 mt-2"
                  >
                    {loading ? 'Sending...' : 'Send reset link'}
                  </button>
                </form>

                <div className="mt-6 pt-6 border-t border-slate-600 text-center">
                  <Link href="/auth" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
                    Back to sign in
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
