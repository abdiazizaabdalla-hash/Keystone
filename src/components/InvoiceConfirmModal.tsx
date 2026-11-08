'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import MoneyInput from '@/components/MoneyInput';

// The "check it before it goes out" screen. Loads what the invoice would be (POST /api/invoices with preview:true),
// lets the coordinator change the fees or add a discount (a promotion, a repeat client), and only creates the
// invoice when they press the button. Works for a closed deal and for a listing.

export interface InvoiceTarget {
  kind: 'transaction' | 'listing';
  agentId?: string | null;
  transactionId?: string;
  purchasePrice?: number | null;
  listingId?: string;
}

interface Preview {
  agent: { name: string; email: string | null };
  property: string;
  fileNumber: string | null;
  purchasePrice: number;
  percentRate: number;
  defaults: { flatFee: number; percentFee: number };
  dueDays: number;
}

interface Props {
  target: InvoiceTarget;
  onClose: () => void;
  /** Called with the created invoice row. */
  onCreated: (invoice: any) => void;
  /** Runs right before the invoice is created (e.g. closing the deal first). Throw to stop. */
  beforeCreate?: () => Promise<void>;
}

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const inputCls =
  'w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

function bodyFor(target: InvoiceTarget, extra: Record<string, unknown>) {
  return target.kind === 'listing'
    ? { kind: 'listing', listingId: target.listingId, ...extra }
    : { agentId: target.agentId, transactionId: target.transactionId, purchasePrice: target.purchasePrice, ...extra };
}

export default function InvoiceConfirmModal({ target, onClose, onCreated, beforeCreate }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [flat, setFlat] = useState('');
  const [pct, setPct] = useState('');
  const [discount, setDiscount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await authFetch('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyFor(target, { preview: true })),
        });
        const json = await res.json();
        if (!live) return;
        if (!res.ok) {
          setLoadError(json.error || 'Could not load the invoice details.');
          return;
        }
        setPreview(json);
        setFlat(String(json.defaults.flatFee ?? 0));
        setPct(String(json.defaults.percentFee ?? 0));
      } catch (e) {
        if (!live) return;
        setLoadError(e instanceof AuthRequiredError ? 'Please sign in again.' : 'Could not load the invoice details.');
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = num(flat) + num(pct);
  const total = Math.max(0, subtotal - num(discount));
  const changed = useMemo(
    () => !!preview && (num(flat) !== preview.defaults.flatFee || num(pct) !== preview.defaults.percentFee || num(discount) > 0),
    [preview, flat, pct, discount]
  );

  const create = async () => {
    if (!preview) return;
    setError('');
    if (total <= 0) {
      setError('The total must be more than $0.');
      return;
    }
    if (num(discount) > subtotal) {
      setError('The discount cannot be more than the fees.');
      return;
    }
    setBusy(true);
    try {
      if (beforeCreate) await beforeCreate();
      const res = await authFetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          bodyFor(target, {
            edits: { flatFee: num(flat), percentFee: num(pct), discount: num(discount), discountNote: note.trim() },
          })
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create invoice');
      onCreated(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create invoice');
    } finally {
      setBusy(false);
    }
  };

  const isListing = target.kind === 'listing';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Confirm invoice">
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">Confirm invoice</h2>
            <p className="text-sm text-slate-400 mt-1">Check the details. Nothing is created until you press the button.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        {loadError ? (
          <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{loadError}</div>
        ) : !preview ? (
          <p className="mt-6 text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-800/50 p-4 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500">Bill to</dt>
                <dd className="mt-0.5 text-slate-100 font-semibold">{preview.agent.name || 'Agent'}</dd>
                <dd className="text-xs text-slate-400">{preview.agent.email || 'No email on file'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-slate-500">{isListing ? 'Listing' : 'Property'}</dt>
                <dd className="mt-0.5 text-slate-100">{preview.property || '—'}</dd>
                {preview.purchasePrice > 0 && (
                  <dd className="text-xs text-slate-400">
                    {isListing ? 'List price' : 'Purchase price'} {money(preview.purchasePrice)}
                  </dd>
                )}
              </div>
            </dl>

            <div className="mt-5 space-y-4">
              <div>
                <label className="text-sm text-slate-300 block mb-1.5">{isListing ? 'Listing fee' : 'Coordination fee'}</label>
                <MoneyInput value={flat} onValueChange={setFlat} aria-label="Flat fee" className={inputCls} />
              </div>
              {!isListing && (preview.percentRate > 0 || preview.defaults.percentFee > 0 || num(pct) > 0) && (
                <div>
                  <label className="text-sm text-slate-300 block mb-1.5">
                    Percentage fee <span className="text-slate-500">({preview.percentRate}% of price)</span>
                  </label>
                  <MoneyInput value={pct} onValueChange={setPct} aria-label="Percentage fee in dollars" className={inputCls} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-slate-300 block mb-1.5">
                    Discount <span className="text-slate-500">(optional)</span>
                  </label>
                  <MoneyInput value={discount} onValueChange={setDiscount} placeholder="0" aria-label="Discount" className={inputCls} />
                </div>
                <div>
                  <label className="text-sm text-slate-300 block mb-1.5">
                    Reason <span className="text-slate-500">(shown on invoice)</span>
                  </label>
                  <input
                    value={note}
                    maxLength={140}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Fall promotion"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
              {num(discount) > 0 && (
                <div className="flex justify-between text-sm text-slate-300">
                  <span>Fees</span>
                  <span>{money(subtotal)}</span>
                </div>
              )}
              {num(discount) > 0 && (
                <div className="flex justify-between text-sm text-emerald-400">
                  <span>Discount{note.trim() ? ` — ${note.trim()}` : ''}</span>
                  <span>−{money(num(discount))}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-semibold text-slate-200">Total due</span>
                <span className="text-2xl font-bold text-white">{money(total)}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Due {preview.dueDays} days after it is created.{changed ? ' You changed the price from the usual amount.' : ''}
              </p>
            </div>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <div className="mt-6 flex gap-3">
              <button
                onClick={create}
                disabled={busy}
                className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50"
              >
                {busy ? 'Creating…' : `Create invoice for ${money(total)}`}
              </button>
              <button onClick={onClose} disabled={busy} className="px-4 py-3 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg transition">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
