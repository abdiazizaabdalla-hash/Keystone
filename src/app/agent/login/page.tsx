'use client';

import { useState } from 'react';
import { supabaseBrowser as supabase } from '@/lib/supabaseClient';

// Returning-agent re-login: no password, ever -- just a fresh magic link
// to whatever email they were originally invited at. Sent directly from
// the browser with the anon key (signInWithOtp is a public endpoint keyed
// by email, same call POST /api/agent-invites makes server-side for a
// brand-new invite), so there's no API route needed for this page.
export default function AgentLoginPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }

    try {
      setSubmitting(true);
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/agent/accept`,
        },
      });
      // Never reveal whether the email has an account -- same
      // no-enumeration approach as /auth/forgot-password. Supabase
      // itself doesn't distinguish "no such user" from success here.
      if (otpError && !/user not found/i.test(otpError.message)) {
        throw otpError;
      }
      setSent(true);
    } catch (err) {
      console.error('Error sending agent login link:', err);
      setError('Something went wrong sending your login link. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img src="/relay-icon.png" alt="Relay TC" className="w-16 h-16 object-contain inline-block mb-4" />
          <h1 className="text-2xl font-display font-semibold text-slate-100">Agent log in</h1>
          <p className="text-slate-400 text-sm mt-1">
            No password needed -- we&apos;ll email you a link that logs you straight in.
          </p>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
          {sent ? (
            <p className="text-slate-200 text-sm text-center">
              If <strong>{email.trim()}</strong> has access to any deals on Relay TC, a login link is on its way.
              Check your inbox.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 block mb-2">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
              >
                {submitting ? 'Sending…' : 'Send login link'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
