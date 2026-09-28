'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser as supabase } from '@/lib/supabaseClient';
import { saveSession } from '@/lib/authClient';

type Status = 'working' | 'error';

function parseHashParams(hash: string): Record<string, string> {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function ConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const plan = searchParams.get('plan');

  const [status, setStatus] = useState<Status>('working');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const finishConfirmation = async () => {
      const hashParams = parseHashParams(window.location.hash);

      // Supabase redirects here with either the tokens directly in the hash
      // (implicit flow) or an error description if the link was invalid,
      // expired, or already used.
      if (hashParams.error) {
        setStatus('error');
        setErrorMessage(
          hashParams.error_description
            ? decodeURIComponent(hashParams.error_description.replace(/\+/g, ' '))
            : 'This confirmation link is invalid or has expired.'
        );
        return;
      }

      const accessToken = hashParams.access_token;
      const refreshToken = hashParams.refresh_token;

      if (!accessToken || !refreshToken) {
        setStatus('error');
        setErrorMessage('This confirmation link is missing required information. Please try signing up again.');
        return;
      }

      try {
        const { data, error } = await supabase.auth.getUser(accessToken);
        if (error || !data.user) {
          throw error || new Error('Could not verify account');
        }

        saveSession(accessToken, refreshToken, data.user.id);

        // Clear the sensitive tokens out of the URL bar before navigating on.
        window.history.replaceState(null, '', window.location.pathname);

        router.replace(plan ? `/onboarding?plan=${plan}` : '/onboarding');
      } catch (err) {
        console.error('Error finishing email confirmation:', err);
        setStatus('error');
        setErrorMessage('We could not confirm your account. Please try signing up again.');
      }
    };

    finishConfirmation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <img src="/relay-icon.png" alt="Relay TC" className="w-16 h-16 object-contain inline-block mb-6" />

        {status === 'working' ? (
          <>
            <h1 className="text-2xl font-display font-semibold text-slate-100 mb-2">Confirming your account…</h1>
            <p className="text-slate-400 text-sm">Hang tight, this only takes a second.</p>
          </>
        ) : (
          <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
            <h1 className="text-xl font-display font-semibold text-slate-100 mb-3">Couldn&apos;t confirm your account</h1>
            <p className="text-slate-400 text-sm mb-6">{errorMessage}</p>
            <Link
              href="/auth?mode=signup"
              className="inline-block px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition"
            >
              Back to sign up
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmContent />
    </Suspense>
  );
}
