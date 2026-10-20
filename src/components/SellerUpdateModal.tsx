'use client';

import { useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { buildSellerUpdate } from '@/lib/sellerUpdate';
import type { ListingStatus } from '@/lib/listingsShared';

interface Props {
  listingId: string;
  tcName: string;
  listing: { property_address: string; seller_name: string | null; seller_email: string | null; status: ListingStatus; list_price: number | null; listed_on?: string | null; expiration_date: string | null; planned_list_date: string | null };
  showings: { showing_date: string; kind: string; interest: string | null; feedback: string | null }[];
  offers: { status: string; offer_price: number | null; terms?: string | null }[];
  priceChanges: { old_price: number | null; new_price: number; changed_on: string }[];
  dates: { label: string; due_date: string }[];
  /** Other people on the listing who can be copied (sellers, co-owners). */
  contacts: { name: string | null; email: string | null; role: string | null }[];
  onClose: () => void;
  onSent: () => void;
}

const inputCls =
  'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

// A seller progress update drafted from what is logged on the listing. Edit it, pick who gets it, send.
export default function SellerUpdateModal({ listingId, tcName, listing, showings, offers, priceChanges, dates, contacts, onClose, onSent }: Props) {
  const draft = useMemo(
    () => buildSellerUpdate({ listing, showings, offers, priceChanges, dates, tcName, today: new Date().toISOString().slice(0, 10) }),
    [listing, showings, offers, priceChanges, dates, tcName]
  );
  const recipients = useMemo(() => {
    const out: { email: string; label: string }[] = [];
    const seen = new Set<string>();
    const add = (email: string | null, label: string) => {
      const e = (email || '').trim().toLowerCase();
      if (!e || seen.has(e)) return;
      seen.add(e);
      out.push({ email: e, label });
    };
    add(listing.seller_email, `${listing.seller_name || 'Seller'} (seller)`);
    for (const c of contacts) if (/seller|owner/i.test(c.role || '')) add(c.email, `${c.name || c.email} (${c.role})`);
    return out;
  }, [listing.seller_email, listing.seller_name, contacts]);

  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [picked, setPicked] = useState<Set<string>>(new Set(recipients.slice(0, 1).map((r) => r.email)));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const send = async () => {
    setSending(true);
    setError('');
    try {
      const res = await authFetch(`/api/listings/${listingId}/send-step-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: [...picked], subject, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send');
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl max-h-[94vh] overflow-y-auto bg-slate-800 border border-slate-600 rounded-xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-700">
          <h2 className="text-lg font-bold text-slate-100">Update for the seller</h2>
          <button type="button" onClick={onClose} disabled={sending} className="text-sm text-slate-400 hover:text-slate-200">
            Cancel
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-400">Drafted from what you have logged (showings, feedback, offers, price, dates). Buyer names are left out. Read it and change anything before you send.</p>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">To</p>
            {recipients.length === 0 ? (
              <p className="text-sm text-amber-300">Add the seller’s email in Details to send this from Relay. You can still copy the text.</p>
            ) : (
              <div className="space-y-1">
                {recipients.map((r) => (
                  <label key={r.email} className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      className="accent-blue-500"
                      checked={picked.has(r.email)}
                      onChange={(e) =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(r.email);
                          else next.delete(r.email);
                          return next;
                        })
                      }
                    />
                    {r.label} <span className="text-slate-500">{r.email}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <input className={inputCls} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
          <textarea className={`${inputCls} font-sans`} rows={16} value={body} maxLength={8000} onChange={(e) => setBody(e.target.value)} aria-label="Message" />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={send} disabled={sending || picked.size === 0 || !subject.trim() || !body.trim()} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
              {sending ? 'Sending…' : 'Send from Relay'}
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${subject}\n\n${body}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* the text is on screen to copy by hand */
                }
              }}
              className="text-sm text-slate-300 hover:text-slate-100"
            >
              {copied ? 'Copied' : 'Copy text'}
            </button>
            <a
              href={`mailto:${[...picked].join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
              className="text-sm text-slate-300 hover:text-slate-100"
            >
              Open in my email app
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
