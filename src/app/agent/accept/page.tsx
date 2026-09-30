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
// establish a session" shape as /auth/confirm -- the only agent-specific
// step is telling /api/agent-invites/accept which transaction this was
// for, when there is one (a plain re-login has no transactionId at all).
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
        const { data, error } = await supabase.auth.getUser(accessToken);
        if (error || !data.user) {
          throw error || new Error('Could not verify account');
        }

        saveSession(accessToken, refreshToken, data.user.id);
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
