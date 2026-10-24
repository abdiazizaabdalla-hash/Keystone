'use client';

import { use, useEffect, useState } from 'react';
import PhoneInput from '@/components/PhoneInput';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';
import ListingThread from '@/components/ListingThread';
import { LISTING_STATUS_LABEL, daysOnMarket, SHOWING_INTEREST_LABEL, SHOWING_KIND_LABEL, type ListingStatus } from '@/lib/listingsShared';

interface Detail {
  listing: {
    id: string;
    propertyAddress: string;
    status: ListingStatus;
    listPrice: number | null;
    plannedListDate: string | null;
    expirationDate: string | null;
    mlsNumber: string | null;
    mlsUrl: string | null;
    sellerName: string | null;
    listedOn?: string | null;
    convertedTransactionId?: string | null;
  };
  tcLabel: string;
  dates: { id: string; label: string; due_date: string }[];
  offers: {
    id: string;
    buyerName: string | null;
    buyerAgent: string | null;
    offerPrice: number | null;
    status: string;
    receivedOn: string | null;
    financing: string | null;
    earnestMoney: number | null;
    optionDays: number | null;
    closingDate: string | null;
    sellerConcessions: number | null;
    offerExpires: string | null;
    possession: string | null;
    contingencies: string | null;
    terms: string | null;
  }[];
  showings: { id: string; showing_date: string; kind: string; visitor: string | null; interest: string | null; feedback: string | null }[];
  priceChanges: { id: string; old_price: number | null; new_price: number; changed_on: string; note: string | null }[];
  checklist: { id: string; name: string; dueDate: string | null; completed: boolean }[];
  contacts: Contact[];
  documents: { id: string; fileName: string; documentType: string; contentType: string | null; fileSize: number | null; isSigned: boolean; createdAt: string }[];
}

interface Contact {
  id: string;
  role: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  addedByAgent: boolean;
}

const DOC_TYPE_ORDER = ['Listing Agreement', 'Seller Disclosure', 'Purchase Contract', 'Other Contract Documents', 'General'];
const sizeLabel = (n: number | null) => (n ? (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : '');
const inputCls = 'w-full bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';
const money = (n: number | null) => (n ? `$${Number(n).toLocaleString('en-US')}` : '—');
const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';
const OFFER_LABEL: Record<string, string> = { received: 'Received', countered: 'Countered', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn' };

// The listing agent's read-only view of a listing their TC is running: where it stands, offers, showings,
// price history and key dates. Notes stay with the TC.
export default function AgentListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [contactForm, setContactForm] = useState({ role: '', name: '', email: '', phone: '' });
  const [addingContact, setAddingContact] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactError, setContactError] = useState('');
  const [docError, setDocError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`/api/agent/listings/${id}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load this listing');
        setData(json);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          router.push('/agent/login');
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load this listing');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, router]);

  const addContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingContact(true);
    setContactError('');
    try {
      const res = await authFetch(`/api/agent/listings/${id}/contacts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contactForm) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not add this person');
      setData((d) => (d ? { ...d, contacts: [...d.contacts, json] } : d));
      setContactForm({ role: '', name: '', email: '', phone: '' });
      setShowContactForm(false);
    } catch (err) {
      if (err instanceof AuthRequiredError) return router.push('/agent/login');
      setContactError(err instanceof Error ? err.message : 'Could not add this person');
    } finally {
      setAddingContact(false);
    }
  };

  const removeContact = async (contactId: string) => {
    setContactError('');
    try {
      const res = await authFetch(`/api/agent/listings/${id}/contacts/${contactId}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not remove this person');
      setData((d) => (d ? { ...d, contacts: d.contacts.filter((c) => c.id !== contactId) } : d));
    } catch (err) {
      if (err instanceof AuthRequiredError) return router.push('/agent/login');
      setContactError(err instanceof Error ? err.message : 'Could not remove this person');
    }
  };

  // The tab is opened first (while the click still counts) and pointed at the file once the link is ready.
  const openDocument = async (docId: string) => {
    setDocError('');
    const tab = window.open('', '_blank');
    try {
      const res = await authFetch(`/api/agent/listings/${id}/documents/${docId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) throw new Error(json.error || 'Could not open that file');
      if (tab) {
        // The new tab must not be able to reach back into this page.
        tab.opener = null;
        tab.location.href = json.url;
      } else {
        window.location.assign(json.url);
      }
    } catch (err) {
      tab?.close();
      if (err instanceof AuthRequiredError) return router.push('/agent/login');
      setDocError(err instanceof Error ? err.message : 'Could not open that file');
    }
  };

  if (loading) return <div className="p-4 md:p-8 text-slate-400">Loading listing…</div>;
  if (error || !data)
    return (
      <div className="p-4 md:p-8">
        <Link href="/agent/listings" className="text-sm text-slate-400 hover:text-slate-200">
          ← Back to your listings
        </Link>
        <p className="mt-4 text-red-400 text-sm">{error || 'Listing not found'}</p>
      </div>
    );

  const { listing, offers, showings, priceChanges, dates, checklist, contacts, documents } = data;
  const today = new Date().toISOString().slice(0, 10);
  const doneCount = checklist.filter((t) => t.completed).length;
  const docGroups = [...new Set(documents.map((d) => d.documentType))].sort(
    (a, b) => (DOC_TYPE_ORDER.indexOf(a) === -1 ? 99 : DOC_TYPE_ORDER.indexOf(a)) - (DOC_TYPE_ORDER.indexOf(b) === -1 ? 99 : DOC_TYPE_ORDER.indexOf(b))
  );

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <Link href="/agent/listings" className="text-sm text-slate-400 hover:text-slate-200">
        ← Back to listings
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 break-words">{listing.propertyAddress}</h1>
          <p className="text-sm text-slate-400 mt-1">
            {[listing.sellerName && `Seller: ${listing.sellerName}`, `Managed by ${data.tcLabel}`, money(listing.listPrice)].filter(Boolean).join(' · ')}
          </p>
          <p className="text-sm text-slate-400 mt-1">
            {(listing.status === 'active' || listing.status === 'under_offer') && daysOnMarket(listing.listedOn) !== null && (
              <span>
                {daysOnMarket(listing.listedOn)} day{daysOnMarket(listing.listedOn) === 1 ? '' : 's'} on market
                {listing.mlsUrl || listing.mlsNumber ? ' · ' : ''}
              </span>
            )}
            {listing.mlsUrl ? (
              <a href={listing.mlsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                View listing{listing.mlsNumber ? ` (MLS ${listing.mlsNumber})` : ''}
              </a>
            ) : listing.mlsNumber ? (
              `MLS ${listing.mlsNumber}`
            ) : null}
          </p>
        </div>
        <span className="px-3 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-sm text-slate-100">{LISTING_STATUS_LABEL[listing.status]}</span>
      </div>

        {listing.convertedTransactionId && (
          <Link
            href={`/agent/transactions/${listing.convertedTransactionId}`}
            className="flex items-center justify-between gap-3 bg-emerald-900/20 border border-emerald-700/50 rounded-lg px-4 py-3 text-sm hover:bg-emerald-900/30 transition"
          >
            <span className="text-slate-200">This listing is now under contract.</span>
            <span className="text-emerald-300 shrink-0">Open the deal →</span>
          </Link>
        )}


      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6 min-w-0">
          <div className={card}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-bold text-slate-100">Checklist</h2>
              <span className="text-xs text-slate-400">
                {doneCount}/{checklist.length} done
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden mb-4" aria-hidden>
              <div className="h-full bg-blue-500" style={{ width: `${checklist.length ? Math.round((doneCount / checklist.length) * 100) : 0}%` }} />
            </div>
            {checklist.length === 0 && <p className="text-sm text-slate-500">No steps yet.</p>}
            <ul className="space-y-1">
              {checklist.map((t) => {
                const overdue = !t.completed && t.dueDate && t.dueDate < today;
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 border-b border-slate-700/50 last:border-0">
                    <input type="checkbox" checked={t.completed} readOnly disabled className="accent-blue-500" aria-label={`${t.name}: ${t.completed ? 'done' : 'not done'}`} />
                    <span className={`flex-1 min-w-[10rem] text-sm break-words ${t.completed ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{t.name}</span>
                    {t.dueDate && <span className={`text-xs ${overdue ? 'text-red-300' : 'text-slate-400'}`}>{formatDisplayDate(t.dueDate)}</span>}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-slate-500 mt-3">Your coordinator keeps this up to date. Message them if something needs to change.</p>
          </div>
        <div className={card}>
          <h2 className="text-lg font-bold text-slate-100 mb-3">Offers</h2>
          {offers.length === 0 && <p className="text-sm text-slate-500">No offers yet.</p>}
          <div className="space-y-3">
            {offers.map((o) => (
              <div key={o.id} className="border border-slate-600 rounded-lg p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-slate-100 font-medium break-words">
                    {o.buyerName || 'Buyer'} {o.offerPrice ? <span className="text-slate-300">· {money(o.offerPrice)}</span> : null}
                  </p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{OFFER_LABEL[o.status] || o.status}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {[
                    o.buyerAgent && `Agent: ${o.buyerAgent}`,
                    o.receivedOn && `Received ${formatDisplayDate(o.receivedOn)}`,
                    o.financing,
                    o.earnestMoney ? `Earnest ${money(o.earnestMoney)}` : '',
                    o.optionDays != null ? `${o.optionDays}-day option` : '',
                    o.closingDate ? `Closing ${formatDisplayDate(o.closingDate)}` : '',
                    o.sellerConcessions ? `Seller pays ${money(o.sellerConcessions)}` : '',
                    o.offerExpires ? `Expires ${o.offerExpires}` : '',
                    o.possession ? `Possession: ${o.possession}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {o.contingencies && <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap break-words">Contingencies: {o.contingencies}</p>}
                {o.terms && <p className="text-sm text-slate-400 mt-2 whitespace-pre-wrap break-words">{o.terms}</p>}
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          <h2 className="text-lg font-bold text-slate-100 mb-1">Showings and feedback</h2>
          <p className="text-xs text-slate-500 mb-3">{showings.length} logged</p>
          {showings.length === 0 && <p className="text-sm text-slate-500">Nothing logged yet.</p>}
          <ul className="space-y-2">
            {showings.map((sh) => (
              <li key={sh.id} className="text-sm border border-slate-600 rounded-lg px-3 py-2">
                <p className="text-slate-200 break-words">
                  <span className="font-medium">{formatDisplayDate(sh.showing_date)}</span>
                  <span className="text-slate-500"> · {SHOWING_KIND_LABEL[sh.kind as keyof typeof SHOWING_KIND_LABEL] || 'Showing'}</span>
                  {sh.visitor ? <span className="text-slate-400"> · {sh.visitor}</span> : null}
                  {sh.interest ? <span className="text-slate-400"> · {SHOWING_INTEREST_LABEL[sh.interest]}</span> : null}
                </p>
                {sh.feedback && <p className="text-slate-400 mt-1 whitespace-pre-wrap break-words">{sh.feedback}</p>}
              </li>
            ))}
          </ul>
        </div>

        {priceChanges.length > 0 && (
          <div className={card}>
            <h2 className="text-lg font-bold text-slate-100 mb-3">Price history</h2>
            <ul className="text-sm space-y-1 text-slate-300">
              {priceChanges.map((pc) => (
                <li key={pc.id}>
                  <span className="text-slate-500">{formatDisplayDate(pc.changed_on)}</span> · {pc.old_price ? `${money(pc.old_price)} → ` : ''}
                  <span className="font-medium text-slate-100">{money(pc.new_price)}</span>
                  {pc.note ? <span className="text-slate-500"> — {pc.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        </div>
        <div className="space-y-6 min-w-0">
        <div className={card}>
          <h2 className="text-lg font-bold text-slate-100 mb-3">Key dates</h2>
          <ul className="text-sm space-y-1">
            {listing.plannedListDate && (
              <li className="flex justify-between gap-3 text-slate-300">
                <span>{listing.plannedListDate > today ? 'Planned list date' : 'List date'}</span>
                <span>{formatDisplayDate(listing.plannedListDate)}</span>
              </li>
            )}
            {listing.expirationDate && (
              <li className="flex justify-between gap-3 text-slate-300">
                <span>Listing expires</span>
                <span>{formatDisplayDate(listing.expirationDate)}</span>
              </li>
            )}
            {dates.map((d) => (
              <li key={d.id} className="flex justify-between gap-3 text-slate-300">
                <span>{d.label}</span>
                <span>{formatDisplayDate(d.due_date)}</span>
              </li>
            ))}
            {!listing.plannedListDate && !listing.expirationDate && dates.length === 0 && <li className="text-slate-500">No dates yet.</li>}
          </ul>
        </div>

        <div className={card}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-bold text-slate-100">People</h2>
            <button type="button" onClick={() => setShowContactForm((v) => !v)} className="text-xs font-semibold text-blue-400 hover:text-blue-300">
              {showContactForm ? 'Cancel' : '+ Add a person'}
            </button>
          </div>
          {contacts.length === 0 && <p className="text-sm text-slate-500">Nobody added yet.</p>}
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 border border-slate-600 rounded-lg px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-slate-100 break-words">
                    {c.name || c.email || c.phone}
                    {c.role && <span className="text-slate-400"> · {c.role}</span>}
                  </p>
                  <p className="text-xs text-slate-400 break-words">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="hover:text-slate-200">
                        {c.email}
                      </a>
                    )}
                    {c.email && c.phone ? ' · ' : ''}
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="hover:text-slate-200">
                        {c.phone}
                      </a>
                    )}
                  </p>
                </div>
                {c.addedByAgent && (
                  <button type="button" onClick={() => removeContact(c.id)} className="text-xs text-slate-500 hover:text-red-400 shrink-0">
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {contactError && <p className="text-sm text-red-400 mt-2">{contactError}</p>}
          {showContactForm && (
            <form onSubmit={addContact} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input className={inputCls} placeholder="Name" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} maxLength={200} />
              <input className={inputCls} placeholder="Role (lender, stager, co-owner…)" value={contactForm.role} onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })} maxLength={60} />
              <input className={inputCls} type="email" placeholder="Email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} maxLength={254} />
              <PhoneInput className={inputCls} placeholder="Phone" value={contactForm.phone} onValueChange={(v) => setContactForm({ ...contactForm, phone: v })} />
              <div className="sm:col-span-2 flex items-center gap-3">
                <button type="submit" disabled={addingContact} className="px-4 py-2 bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                  {addingContact ? 'Adding…' : 'Add person'}
                </button>
                <span className="text-xs text-slate-500">Your coordinator sees who you add. Nobody is emailed.</span>
              </div>
            </form>
          )}
        </div>

        <div className={card}>
          <h2 className="text-lg font-bold text-slate-100 mb-3">Documents</h2>
          {documents.length === 0 && <p className="text-sm text-slate-500">No documents yet.</p>}
          {docError && <p className="text-sm text-red-400 mb-2">{docError}</p>}
          <div className="space-y-4">
            {docGroups.map((type) => (
              <div key={type}>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{type}</p>
                <ul className="space-y-1.5">
                  {documents
                    .filter((d) => d.documentType === type)
                    .map((d) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => openDocument(d.id)}
                          className="w-full text-left flex items-center justify-between gap-3 border border-slate-600 rounded-lg px-3 py-2 text-sm hover:bg-slate-600/30 transition"
                        >
                          <span className="text-slate-200 break-words min-w-0">
                            {d.fileName}
                            {d.isSigned && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">Signed</span>}
                          </span>
                          <span className="text-xs text-slate-500 shrink-0">{[sizeLabel(d.fileSize), formatDisplayDate(d.createdAt.slice(0, 10))].filter(Boolean).join(' · ')}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <ListingThread endpoint={`/api/agent/listings/${id}/comments`} self="agent" otherLabel={data.tcLabel} />
        </div>
      </div>
    </div>
  );
}
