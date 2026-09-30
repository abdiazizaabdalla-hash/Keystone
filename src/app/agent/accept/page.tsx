'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser as supabase } from '@/lib/supabaseClient';
import { saveSession, authFetch, AuthRequiredError } from '@/lib/authClient';

type Status = 'working' | 'error';

function parseHashParams(hash: string): Record<string, string> {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

// Landing page for both links Supabase's signInWithOtp sends: a brand
// new agent's first-ever login, and a returning agent's (see
// /agent/login) plain re-login. Same "read tokens from the URL hash,
// establish a session" shape as /auth/confirm. Two agent-specific steps
// on top of that: telling /api/agent-invites/accept which transaction
// this was for, when there is one (a plain re-login has no transactionId
// at all), and routing a brand-new agent to /agent/welcome to set a
// password before they ever see a dashboard.
function AcceptContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const transactionId = searchParams.get('transactionId');

  const [status, setStatus] = useState<Status>('working');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const finish = async () => {
      const hashParams = parseHashParams(window.location.hash);

      if (hashParams.error) {
        setStatus('error');
        setErrorMessage(
          hashParams.error_description
            ? decodeURIComponent(hashParams.error_description.replace(/\+/g, ' '))
            : 'This login link is invalid or has expired.'
        );
        return;
      }

      const accessToken = hashParams.access_token;
      const refreshToken = hashParams.refresh_token;

      if (!accessToken || !refreshToken) {
        setStatus('error');
        setErrorMessage('This login link is missing required information. Please request a new one.');
        return;
      }

      try {
        // setSession (not just getUser) puts this session on the shared
        // browser client itself, the same thing /auth/reset-password does
        // -- needed so /agent/welcome can call updateUser() to set a
        // password on it right after this.
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error || !data.session) {
          throw error || new Error('Could not verify account');
        }

        saveSession(data.session.access_token, data.session.refresh_token, data.session.user.id);
        window.history.replaceState(null, '', window.location.pathname + window.location.search);

        if (transactionId) {
          const res = await authFetch('/api/agent-invites/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactionId }),
          });
          if (!res.ok) {
            const result = await res.json().catch(() => ({}));
            throw new Error(result.error || 'Could not confirm your access to this transaction');
          }
        }

        // First time this agent has ever accepted an invite: no password
        // on the account yet (it exists purely from signInWithOtp), so
        // send them to set one up before landing on their dashboard --
        // every later login/invite skips straight past this.
        const needsPassword = data.session.user.user_metadata?.has_password !== true;
        if (needsPassword) {
          router.replace(transactionId ? `/agent/welcome?transactionId=${transactionId}` : '/agent/welcome');
        } else if (transactionId) {
          router.replace(`/agent/transactions/${transactionId}`);
        } else {
          router.replace('/agent');
        }
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          setStatus('error');
          setErrorMessage('Your session could not be confirmed. Please request a new login link.');
          return;
        }
        console.error('Error finishing agent login:', err);
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'We could not log you in. Please request a new link.');
      }
    };

    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <img src="/relay-icon.png" alt="Relay TC" className="w-16 h-16 object-contain inline-block mb-6" />

        {status === 'working' ? (
          <>
            <h1 className="text-2xl font-display font-semibold text-slate-100 mb-2">Logging you in…</h1>
            <p className="text-slate-400 text-sm">Hang tight, this only takes a second.</p>
          </>
        ) : (
          <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
            <h1 className="text-xl font-display font-semibold text-slate-100 mb-3">Couldn&apos;t log you in</h1>
            <p className="text-slate-400 text-sm mb-6">{errorMessage}</p>
            <Link href="/agent/login" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
              Request a new login link
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentAcceptPage() {
  return (
    <Suspense fallback={null}>
      <AcceptContent />
    </Suspense>
  );
}
