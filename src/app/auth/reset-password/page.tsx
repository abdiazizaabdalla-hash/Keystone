'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser as supabase } from '@/lib/supabaseClient';
import { saveSession } from '@/lib/authClient';

type LinkStatus = 'checking' | 'ready' | 'invalid';

function parseHashParams(hash: string): Record<string, string> {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function ResetPasswordContent() {
  const router = useRouter();

  const [linkStatus, setLinkStatus] = useState<LinkStatus>('checking');
  const [linkError, setLinkError] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const establishRecoverySession = async () => {
      // Supabase's recovery link redirects here with the tokens in the
      // URL hash (same implicit-flow shape /auth/confirm already parses),
      // or an error description if the link was invalid, expired, or
      // already used.
      const hashParams = parseHashParams(window.location.hash);

      if (hashParams.error) {
        setLinkStatus('invalid');
        setLinkError(
          hashParams.error_description
            ? decodeURIComponent(hashParams.error_description.replace(/\+/g, ' '))
            : 'This password reset link is invalid or has expired.'
        );
        return;
      }

      const accessToken = hashParams.access_token;
      const refreshToken = hashParams.refresh_token;

      if (!accessToken || !refreshToken) {
        setLinkStatus('invalid');
        setLinkError('This password reset link is missing required information. Please request a new one.');
        return;
      }

      try {
        // Puts this recovery session on the shared browser client so
        // updateUser() below can act on it. This is the per-viewer
        // browser client (src/lib/supabaseClient.ts), not one of the
        // shared server singletons -- setting a session on it here only
        // affects this person's own tab.
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) throw error;

        // Clear the sensitive tokens out of the URL bar now that the
        // session is established, before showing the form.
        window.history.replaceState(null, '', window.location.pathname);
        setLinkStatus('ready');
      } catch (err) {
        console.error('Error establishing password reset session:', err);
        setLinkStatus('invalid');
        setLinkError('We could not verify this reset link. Please request a new one.');
      }
    };

    establishRecoverySession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // The recovery session set above is a real session -- reuse it
      // so they land in the app already signed in with their new
      // password, instead of being sent back to /auth to sign in again.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        saveSession(data.session.access_token, data.session.refresh_token, data.session.user.id);
      }

      setDone(true);
      setTimeout(() => router.push('/dashboard'), 1500);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to update password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/relay-icon.png" alt="Relay TC" className="w-16 h-16 object-contain inline-block mb-2" />
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
          {linkStatus === 'checking' && (
            <>
              <h1 className="text-xl font-display font-semibold text-slate-100 mb-2">Verifying your link…</h1>
              <p className="text-slate-400 text-sm">Hang tight, this only takes a second.</p>
            </>
          )}

          {linkStatus === 'invalid' && (
            <>
              <h1 className="text-xl font-display font-semibold text-slate-100 mb-3">
                This link doesn&apos;t work anymore
              </h1>
              <p className="text-slate-400 text-sm mb-6">{linkError}</p>
              <Link
                href="/auth/forgot-password"
                className="inline-block px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition"
              >
                Request a new link
              </Link>
            </>
          )}

          {linkStatus === 'ready' && !done && (
            <>
              <h2 className="text-2xl font-display font-semibold text-slate-100 mb-1">Set a new password</h2>
              <p className="text-slate-400 text-sm mb-6">Choose a new password for your account.</p>

              {formError && (
                <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-sm text-slate-400 block mb-2">New password</label>
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
                  <label className="text-sm text-slate-400 block mb-2">Confirm new password</label>
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
                  {submitting ? 'Updating...' : 'Update password'}
                </button>
              </form>
            </>
          )}

          {done && (
            <>
              <h2 className="text-2xl font-display font-semibold text-slate-100 mb-2">Password updated</h2>
              <p className="text-slate-400 text-sm">Taking you to your dashboard…</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
