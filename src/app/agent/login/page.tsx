'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser as supabase } from '@/lib/supabaseClient';
import { saveSession } from '@/lib/authClient';

// Returning-agent login. Password is the default now that every agent
// sets one during /agent/welcome (their first-ever invite acceptance) --
// same POST /api/auth/signin any TC account already uses, since an agent
// is just a Supabase Auth user distinguished by user_metadata.role. The
// magic-link mode below is only the fallback for someone who forgot
// their password (or, in principle, never finished /agent/welcome).
export default function AgentLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'password' | 'link'>('password');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@') || !password) {
      setError('Enter your email and password.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.session?.access_token) {
        setError(data.error || 'Incorrect email or password.');
        return;
      }
      saveSession(data.session.access_token, data.session.refresh_token, data.user.id);
      router.push('/agent');
    } catch (err) {
      console.error('Error signing in as agent:', err);
      setError('Something went wrong signing you in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
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

  const switchMode = (next: 'password' | 'link') => {
    setMode(next);
    setError('');
    setSent(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img src="/relay-icon.png" alt="Relay TC" className="w-16 h-16 object-contain inline-block mb-4" />
          <h1 className="text-2xl font-display font-semibold text-slate-100">Agent log in</h1>
          <p className="text-slate-400 text-sm mt-1">
            {mode === 'password'
              ? 'Log in with the password you set when you first accepted an invite.'
              : "No password needed -- we'll email you a link that logs you straight in."}
          </p>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
          {mode === 'password' ? (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
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
              <div>
                <label className="text-sm text-slate-400 block mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
              >
                {submitting ? 'Logging in…' : 'Log in'}
              </button>
              <button
                type="button"
                onClick={() => switchMode('link')}
                className="w-full text-center text-sm text-blue-400 hover:text-blue-300"
              >
                Forgot your password, or never set one? Email me a login link
              </button>
            </form>
          ) : sent ? (
            <p className="text-slate-200 text-sm text-center">
              If <strong>{email.trim()}</strong> has access to any deals on Relay TC, a login link is on its way.
              Check your inbox.
            </p>
          ) : (
            <form onSubmit={handleLinkSubmit} className="space-y-4">
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
              <button
                type="button"
                onClick={() => switchMode('password')}
                className="w-full text-center text-sm text-blue-400 hover:text-blue-300"
              >
                Back to password login
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
