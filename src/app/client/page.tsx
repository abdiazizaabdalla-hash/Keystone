'use client';

import { useState } from 'react';
import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';

// For a buyer or seller: no account needed. Your agent or coordinator shares a progress page by email; if you lose it,
// enter your email here and we send it again.
export default function ClientAccessPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/client/request-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Something went wrong. Please try again.');
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      <PublicHeader />
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 shadow-xl">
            <h1 className="text-2xl font-display font-semibold text-slate-100 mb-1">Client access</h1>
            <p className="text-slate-400 text-sm mb-6">Buying or selling a home? Your agent or coordinator shared a progress page with you. Enter the email they used and we will send the link again. No account or password needed.</p>
            {sent ? (
              <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-4">
                If that email is on a transaction, a message with your link is on its way. Check your spam folder too.
              </p>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Your email"
                  className="w-full px-4 py-2.5 bg-slate-900/60 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-400"
                />
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button type="submit" disabled={busy || !email.trim()} className="w-full py-2.5 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50">
                  {busy ? 'Sending…' : 'Email me my link'}
                </button>
              </form>
            )}
          </div>
          <p className="mt-6 text-center text-slate-500 text-sm">
            Agent or coordinator?{' '}
            <Link href="/auth" className="text-blue-400 hover:text-blue-300 font-medium">Sign in here</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
