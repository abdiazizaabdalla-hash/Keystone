'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser as supabase } from '@/lib/supabaseClient';
import { saveSession, clearSession } from '@/lib/authClient';

// One-time stop between an agent's first-ever sign-in and their
// dashboard: the account is created with no password at all (whether
// from an invite's generated link or a plain /agent/login), so
// /agent/accept sends them here (via user_metadata.has_password) before
// they ever land on the hub. Every later login skips straight past this
// -- see /agent/accept. Always lands on /agent afterward, where any
// pending invite is waiting for an explicit accept.
//
// Reuses the exact session already set on the shared browser client by
// /agent/accept's setSession() call (same approach as
// /auth/reset-password: set the session once, then call updateUser() on
// it), so this never needs its own token or API route.
function WelcomeContent() {
  const router = useRouter();

  const [checkingSession, setCheckingSession] = useState(true);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        clearSession();
        router.replace('/agent/login');
        return;
      }
      const existingName = data.session.user.user_metadata?.full_name;
      if (typeof existingName === 'string') setFullName(existingName);
      setCheckingSession(false);
    };
    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!fullName.trim()) {
      setError('Enter your name.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const { data: current } = await supabase.auth.getUser();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: {
          ...current.user?.user_metadata,
          full_name: fullName.trim(),
          has_password: true,
        },
      });
      if (updateError) throw updateError;

      // Refresh local storage with whatever session came back from the
      // update so authFetch keeps working without a re-login.
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        saveSession(sessionData.session.access_token, sessionData.session.refresh_token, sessionData.session.user.id);
      }

      router.replace('/agent');
    } catch (err) {
      console.error('Error setting agent password:', err);
      setError(err instanceof Error ? err.message : 'Could not set your password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <p className="text-slate-400 text-sm">Hang tight…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img src="/relay-icon.png" alt="Relay TC" className="w-16 h-16 object-contain inline-block mb-4" />
          <h1 className="text-2xl font-display font-semibold text-slate-100">Set up your free account</h1>
          <p className="text-slate-400 text-sm mt-1">
            You&apos;re in. Add your name and a password so you can log straight back in next time.
          </p>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 block mb-2">Your name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith"
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
            <div>
              <label className="text-sm text-slate-400 block mb-2">Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                required
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50 mt-2"
            >
              {submitting ? 'Setting up…' : 'Continue to your dashboard'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function AgentWelcomePage() {
  return (
    <Suspense fallback={null}>
      <WelcomeContent />
    </Suspense>
  );
}
