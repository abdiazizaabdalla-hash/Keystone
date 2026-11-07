'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

// Takes the signed-in TC or agent straight to Stripe's hosted onboarding, and Stripe brings them back to this same page.
export function ConnectStripeButton({ label = 'Connect Stripe', className }: { label?: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const next = `${window.location.pathname}${window.location.search.replace(/[?&]stripe=[^&]*/g, '').replace(/^&/, '?')}`;
      const res = await authFetch('/api/stripe/connect/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'settings', next }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start Stripe setup');
      window.location.href = data.url;
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not start Stripe setup');
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className={className || 'px-4 py-2 bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold rounded-lg disabled:opacity-50'}
      >
        {busy ? 'Opening Stripe...' : label}
      </button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </span>
  );
}

// Shown only while the signed-in user has not finished connecting Stripe. Renders nothing once they have.
export function StripeConnectNotice({ message }: { message: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'needs'>('loading');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authFetch('/api/stripe/connect/account');
        const data = await res.json();
        if (!alive) return;
        setPending(!!data.connected);
        setState(res.ok && data.status === 'approved' ? 'ready' : 'needs');
      } catch {
        if (alive) setState('ready');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state !== 'needs') return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-4">
      <p className="text-sm text-indigo-100">{message}</p>
      <ConnectStripeButton label={pending ? 'Finish Stripe setup' : 'Connect Stripe'} />
    </div>
  );
}
