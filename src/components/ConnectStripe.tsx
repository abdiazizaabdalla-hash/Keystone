'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { STRIPE_CONNECTED_EVENT, showToast } from '@/lib/toast';

async function stripeStatus(): Promise<{ connected: boolean; status: string | null } | null> {
  try {
    const res = await authFetch('/api/stripe/connect/account');
    if (!res.ok) return null;
    const data = await res.json();
    return { connected: !!data.connected, status: data.status ?? null };
  } catch {
    return null;
  }
}

// Opens Stripe's hosted setup in a NEW tab (this page stays put), then watches for the connection to finish so the page can
// say so right away. Stripe's return page is this same page, so finishing in the other tab works too.
export function ConnectStripeButton({ label = 'Connect Stripe', className }: { label?: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAt = useRef(0);

  const stopPolling = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
    setWaiting(false);
  };
  useEffect(() => () => stopPolling(), []);

  const startPolling = () => {
    stopAt.current = Date.now() + 15 * 60_000;
    setWaiting(true);
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      if (Date.now() > stopAt.current) return stopPolling();
      const s = await stripeStatus();
      if (s?.status === 'approved') {
        stopPolling();
        window.dispatchEvent(new CustomEvent(STRIPE_CONNECTED_EVENT));
        showToast({ title: 'Stripe is connected', body: 'Pay online links and card or bank payments are now on for your invoices.', tone: 'success', durationMs: 10_000 });
      }
    }, 4000);
  };

  const go = async () => {
    setBusy(true);
    setError('');
    // Opened straight from the click so the browser allows it, then pointed at Stripe once we have the link.
    const tab = window.open('about:blank', '_blank');
    try {
      const next = `${window.location.pathname}${window.location.search.replace(/[?&]stripe=[^&]*/g, '').replace(/^&/, '?')}`;
      const res = await authFetch('/api/stripe/connect/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'settings', next }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start Stripe setup');
      if (tab) tab.location.href = data.url;
      else window.open(data.url, '_blank', 'noopener,noreferrer'); // pop-up blocked: try once more
      startPolling();
    } catch (e) {
      tab?.close();
      if (e instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not start Stripe setup');
    } finally {
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
      {waiting && <span className="text-xs text-indigo-200">Finish setup in the Stripe tab. This page updates by itself when you are done.</span>}
      {error && <span className="text-xs text-red-300">{error}</span>}
    </span>
  );
}

// Shown only while the signed-in user has not finished connecting Stripe. Disappears (with a confirmation) once they have.
export function StripeConnectNotice({ message }: { message: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'needs'>('loading');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await stripeStatus();
      if (!alive) return;
      if (!s) return setState('ready');
      setPending(s.connected);
      setState(s.status === 'approved' ? 'ready' : 'needs');
    })();
    const onConnected = () => setState('ready');
    window.addEventListener(STRIPE_CONNECTED_EVENT, onConnected);
    return () => {
      alive = false;
      window.removeEventListener(STRIPE_CONNECTED_EVENT, onConnected);
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
