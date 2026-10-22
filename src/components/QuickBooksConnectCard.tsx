'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { SUPPORT_EMAIL } from '@/lib/site';

// Settings card for the direct QuickBooks Online connection (coordinators only).
// With it on, an invoice created in Relay is created in QuickBooks, and a payment (including a Stripe payment)
// is recorded on it. The file import/export on the Invoices page keeps working either way.

interface Status {
  available: boolean;
  connected: boolean;
  needsReconnect: boolean;
  companyName: string | null;
  environment: 'production' | 'sandbox' | null;
  syncInvoices: boolean;
  syncPayments: boolean;
  lastSyncedAt: string | null;
  pending: number;
  needsAttention: number;
}

export default function QuickBooksConnectCard() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'send' | null>(null);
  const [progress, setProgress] = useState('');

  const authError = useCallback(
    (e: unknown) => {
      if (e instanceof AuthRequiredError) {
        router.push('/auth');
        return true;
      }
      return false;
    },
    [router]
  );

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/quickbooks/status');
      if (res.ok) setStatus(await res.json());
    } catch (e) {
      if (!authError(e)) console.error('Error loading QuickBooks status:', e);
    }
  }, [authError]);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('quickbooks');
    const t = setTimeout(() => {
      if (result === 'connected') setMessage('QuickBooks connected. New invoices now go to QuickBooks. Use “Send my invoices” to send the ones you already have.');
      else if (result === 'error') setMessage('Something went wrong connecting QuickBooks. Please try again.');
    }, 0);
    let live = true;
    authFetch('/api/quickbooks/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d) setStatus(d);
      })
      .catch((e) => {
        if (!authError(e)) console.error('Error loading QuickBooks status:', e);
      });
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [authError]);

  const connect = async () => {
    setBusy('connect');
    setMessage('');
    try {
      const res = await authFetch('/api/quickbooks/connect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start the connection');
      window.location.href = data.url;
    } catch (e) {
      if (!authError(e)) setMessage(e instanceof Error ? e.message : 'Could not start the connection');
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect QuickBooks? Relay stops sending invoices and payments. Everything already in QuickBooks stays there.')) return;
    setBusy('disconnect');
    setMessage('');
    try {
      const res = await authFetch('/api/quickbooks/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not disconnect');
      setMessage('QuickBooks disconnected.');
      await load();
    } catch (e) {
      if (!authError(e)) setMessage(e instanceof Error ? e.message : 'Could not disconnect');
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (key: 'syncInvoices' | 'syncPayments') => {
    if (!status) return;
    const next = { ...status, [key]: !status[key] };
    setStatus(next);
    try {
      const res = await authFetch('/api/quickbooks/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next[key] }),
      });
      if (!res.ok) throw new Error();
    } catch (e) {
      setStatus(status);
      if (!authError(e)) setMessage('Could not save that choice.');
    }
  };

  const send = async (retryFailed: boolean) => {
    setBusy('send');
    setMessage('');
    let ok = 0;
    let failed = 0;
    try {
      for (let i = 0; i < 100; i++) {
        const res = await authFetch('/api/quickbooks/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ retryFailed }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not send');
        ok += data.ok;
        failed += data.failed;
        setProgress(`Sent ${ok}${data.remaining ? `, ${data.remaining} to go…` : ''}`);
        if (!data.remaining || data.processed === 0) break;
      }
      setMessage(`Done: ${ok} sent${failed ? `, ${failed} need attention (see Invoices)` : ''}.`);
      await load();
    } catch (e) {
      if (!authError(e)) setMessage(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusy(null);
      setProgress('');
    }
  };

  const btn = 'text-sm px-4 py-2 rounded-lg transition disabled:opacity-50';
  const primary = `${btn} bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold`;
  const ghost = `${btn} border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100`;

  return (
    <div id="quickbooks" className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-lg font-bold text-slate-100">QuickBooks Online</h2>
        {status?.connected && !status.needsReconnect && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-900/30 text-green-300 border border-green-700/50">
            Connected{status.environment === 'sandbox' ? ' (test company)' : ''}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-400 mb-4">
        Connect once and the invoices you create in Relay appear in QuickBooks, and payments are recorded on them automatically, so nothing is entered twice.
      </p>

      {message && <div className="mb-4 text-sm text-slate-300">{message}</div>}

      {!status ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : status.connected ? (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            {status.needsReconnect
              ? 'QuickBooks ended the connection (this happens when access is revoked or expires). Reconnect to keep invoices flowing.'
              : `Connected to ${status.companyName || 'your QuickBooks company'}.${status.lastSyncedAt ? ` Last updated ${new Date(status.lastSyncedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : ''}`}
          </p>

          {status.needsReconnect ? (
            <button type="button" onClick={connect} disabled={busy !== null} className={primary}>
              {busy === 'connect' ? 'Opening QuickBooks…' : 'Reconnect QuickBooks'}
            </button>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-start gap-3 rounded-lg border border-slate-700 px-3 py-2.5 cursor-pointer hover:border-slate-500">
                  <input type="checkbox" checked={status.syncInvoices} onChange={() => toggle('syncInvoices')} className="mt-0.5 h-4 w-4 accent-blue-500" />
                  <span>
                    <span className="block text-sm text-slate-200">Create invoices in QuickBooks</span>
                    <span className="block text-xs text-slate-500">Each new Relay invoice, under the agent as a customer. An invoice with the same number already in QuickBooks is linked, not duplicated.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-lg border border-slate-700 px-3 py-2.5 cursor-pointer hover:border-slate-500">
                  <input type="checkbox" checked={status.syncPayments} onChange={() => toggle('syncPayments')} className="mt-0.5 h-4 w-4 accent-blue-500" />
                  <span>
                    <span className="block text-sm text-slate-200">Record payments in QuickBooks</span>
                    <span className="block text-xs text-slate-500">When an invoice is paid in Relay (by Stripe or marked paid), the payment is recorded on its QuickBooks invoice.</span>
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => send(false)} disabled={busy !== null || status.pending === 0} className={primary}>
                  {busy === 'send' ? progress || 'Sending…' : status.pending ? `Send my invoices (${status.pending} waiting)` : 'All invoices sent'}
                </button>
                {status.needsAttention > 0 && (
                  <button type="button" onClick={() => send(true)} disabled={busy !== null} className={ghost}>
                    Retry {status.needsAttention} that need attention
                  </button>
                )}
                <Link href="/dashboard/invoices" target="_blank" rel="noopener noreferrer" className={ghost}>
                  See invoices
                </Link>
                <Link href="/dashboard/invoices/quickbooks" target="_blank" rel="noopener noreferrer" className={ghost}>
                  Import / export files
                </Link>
              </div>
              <p className="text-xs text-slate-500">
                Payments are recorded for the amount the agent paid, before any Stripe fees, and go to QuickBooks’ default (Undeposited Funds) until you match the deposit. Refunds are not recorded automatically.
              </p>
            </>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={disconnect} disabled={busy !== null} className={ghost}>
              {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </button>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('QuickBooks help')}&body=${encodeURIComponent('Describe what happened. If an invoice shows a "QuickBooks ref", paste it here.\n\n')}`}
              className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2"
            >
              Need help with QuickBooks? Contact support
            </a>
          </div>
        </div>
      ) : status.available ? (
        <button type="button" onClick={connect} disabled={busy !== null} className={primary}>
          {busy === 'connect' ? 'Opening QuickBooks…' : 'Connect QuickBooks'}
        </button>
      ) : (
        <p className="text-xs text-slate-400">
          The direct connection is coming soon. You can move invoices today with the{' '}
          <Link href="/dashboard/invoices/quickbooks" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
            QuickBooks import and export files
          </Link>
          .
        </p>
      )}
    </div>
  );
}
