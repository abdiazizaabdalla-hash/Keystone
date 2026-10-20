'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';
import ContactPicker from '@/components/ContactPicker';
import StepEmailModal from '@/components/StepEmailModal';
import OfferIntakeModal from '@/components/OfferIntakeModal';
import OfferHistory from '@/components/OfferHistory';
import {
  FINANCING_TYPES,
  LISTING_STATUS_LABEL,
  LISTING_STATUSES,
  LISTING_DOC_TYPES,
  SHOWING_INTEREST_LABEL,
  SHOWING_KIND_LABEL,
  type ListingStatus,
} from '@/lib/listingsShared';

interface Listing {
  id: string;
  agent_id: string | null;
  property_address: string;
  seller_name: string | null;
  seller_email: string | null;
  seller_phone: string | null;
  list_price: number | null;
  planned_list_date: string | null;
  expiration_date: string | null;
  mls_number: string | null;
  mls_url: string | null;
  status: ListingStatus;
  notes: string | null;
  converted_transaction_id: string | null;
  share_with_agent?: boolean | null;
}
interface Task { id: string; name: string; due_date: string | null; completed: boolean }
interface Offer {
  id: string;
  buyer_name: string | null;
  buyer_agent: string | null;
  offer_price: number | null;
  terms: string | null;
  status: string;
  received_on: string | null;
  financing?: string | null;
  earnest_money?: number | null;
  option_days?: number | null;
  closing_date?: string | null;
  seller_concessions?: number | null;
  offer_expires_at?: string | null;
  possession?: string | null;
  contingencies?: string | null;
  current_version?: number | null;
}
interface Showing { id: string; showing_date: string; kind: string; visitor: string | null; interest: string | null; feedback: string | null }
interface PriceChange { id: string; old_price: number | null; new_price: number; changed_on: string; note: string | null }
interface ActivityRow { id: string; actor_label: string | null; summary: string; created_at: string }
interface Contact { id: string; role: string | null; name: string | null; email: string | null; phone: string | null }
interface DateRow { id: string; label: string; due_date: string }
interface Detail {
  listing: Listing;
  agent: { id: string; name: string; email?: string | null } | null;
  tasks: Task[];
  offers: Offer[];
  contacts: Contact[];
  dates: DateRow[];
  showings?: Showing[];
  priceChanges?: PriceChange[];
  activity?: ActivityRow[];
}

const inputCls =
  'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';
const labelCls = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5';
interface ListingDoc {
  id: string;
  file_name: string;
  document_type: string;
  file_size: number | null;
  created_at: string;
  url: string | null;
}

const cardCls = 'bg-slate-800/50 border border-slate-700 rounded-lg p-5';
const OFFER_LABEL: Record<string, string> = { received: 'Received', countered: 'Countered', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn' };
const money = (n: number | null) => (n ? `$${Number(n).toLocaleString('en-US')}` : '');
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [agents, setAgents] = useState<{ id: string; name: string; email?: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Details form
  const [det, setDet] = useState({ propertyAddress: '', agentId: '', sellerName: '', sellerEmail: '', sellerPhone: '', listPrice: '', plannedListDate: '', expirationDate: '', mlsNumber: '', mlsUrl: '', notes: '', shareWithAgent: true });
  const [savingDetails, setSavingDetails] = useState(false);

  // Add forms
  const [newStep, setNewStep] = useState('');
  const EMPTY_OFFER = { buyerName: '', buyerAgent: '', offerPrice: '', receivedOn: '', terms: '', financing: '', earnestMoney: '', optionDays: '', closingDate: '', sellerConcessions: '' };
  const [newOffer, setNewOffer] = useState(EMPTY_OFFER);
  const [emailTask, setEmailTask] = useState<Task | null>(null);
  // Offer intake: 'new' = from documents, an Offer = counteroffer/amendment for it
  const [intake, setIntake] = useState<'new' | Offer | null>(null);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [newShowing, setNewShowing] = useState({ showingDate: '', kind: 'showing', visitor: '', interest: '', feedback: '' });
  const [priceForm, setPriceForm] = useState({ price: '', note: '' });
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [newDate, setNewDate] = useState({ label: '', dueDate: '' });
  const [newContact, setNewContact] = useState({ role: '', name: '', email: '', phone: '' });

  // Documents
  const [docs, setDocs] = useState<ListingDoc[]>([]);
  const [docType, setDocType] = useState('General');
  const [uploading, setUploading] = useState(false);
  const [docError, setDocError] = useState('');

  // Convert modal
  const [convertOffer, setConvertOffer] = useState<Offer | 'none' | null>(null);
  const [conv, setConv] = useState({ fileNumber: '', acceptanceDate: '', closingDate: '', price: '' });
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState('');

  const handleAuth = useCallback(
    (err: unknown) => {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return true;
      }
      return false;
    },
    [router]
  );

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  };

  const call = useCallback(async (method: string, path: string, body?: unknown) => {
    const res = await authFetch(path, {
      method,
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Something went wrong');
    return json;
  }, []);

  // `resetForm` refills the Details form from the saved listing. It is off for changes made
  // elsewhere on the page, so ticking a step never wipes edits you have typed but not saved.
  const applyDetail = useCallback((d: Detail, resetForm = false) => {
    setData(d);
    if (!resetForm) return;
    const l = d.listing;
    setDet({
      propertyAddress: l.property_address,
      agentId: l.agent_id || '',
      sellerName: l.seller_name || '',
      sellerEmail: l.seller_email || '',
      sellerPhone: l.seller_phone || '',
      listPrice: l.list_price ? String(l.list_price) : '',
      plannedListDate: l.planned_list_date || '',
      expirationDate: l.expiration_date || '',
      mlsNumber: l.mls_number || '',
      mlsUrl: l.mls_url || '',
      notes: l.notes || '',
      shareWithAgent: l.share_with_agent !== false,
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const [d, a] = await Promise.all([call('GET', `/api/listings/${id}`), authFetch('/api/agents').then((r) => r.json()).catch(() => [])]);
      applyDetail(d, true);
      if (Array.isArray(a)) setAgents(a.map((x: { id: string; name: string; email?: string | null }) => ({ id: x.id, name: x.name, email: x.email ?? null })));
      setError('');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to load listing');
    } finally {
      setLoading(false);
    }
  }, [id, call, applyDetail, handleAuth]);

  const loadDocs = useCallback(async () => {
    try {
      const d = await call('GET', `/api/listings/${id}/documents`);
      if (Array.isArray(d)) setDocs(d);
    } catch {
      // The table may not exist yet on a fresh setup; the card then simply stays empty.
    }
  }, [id, call]);

  useEffect(() => {
    const t = setTimeout(() => {
      load();
      loadDocs();
    }, 0);
    return () => clearTimeout(t);
  }, [load, loadDocs]);

  const uploadDocs = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setDocError('');
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('documentType', docType);
        const res = await authFetch(`/api/listings/${id}/documents`, { method: 'POST', body: fd });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${file.name}: ${json.error || 'upload failed'}`);
      }
      await loadDocs();
    } catch (err) {
      if (!handleAuth(err)) setDocError(err instanceof Error ? err.message : 'Upload failed');
      await loadDocs();
    } finally {
      setUploading(false);
    }
  };

  // Runs a change, then re-reads the page so everything (due dates, counts) is current.
  const act = async (fn: () => Promise<unknown>, okMsg?: string, resetForm = false) => {
    setError('');
    try {
      await fn();
      applyDetail(await call('GET', `/api/listings/${id}`), resetForm);
      if (okMsg) flash(okMsg);
      return true;
    } catch (err) {
      if (handleAuth(err)) return false;
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return false;
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <p className="text-slate-400">Loading listing…</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-4 md:p-8">
        <Link href="/dashboard/listings" className="text-sm text-slate-400 hover:text-slate-200">
          ← Back to listings
        </Link>
        <p className="mt-4 text-red-400">{error || 'Listing not found'}</p>
      </div>
    );
  }

  const { listing, tasks, offers, contacts, dates } = data;
  const showings = data.showings || [];
  const priceChanges = data.priceChanges || [];
  const activity = data.activity || [];
  const hotCount = showings.filter((sh) => sh.interest === 'hot').length;
  // Offers still in play, compared side by side (net = price minus what the seller pays toward the buyer's costs)
  const comparable = offers.filter((o) => o.status === 'received' || o.status === 'countered' || o.status === 'accepted');
  const netOf = (o: Offer) => (o.offer_price ? Number(o.offer_price) - Number(o.seller_concessions || 0) : null);
  const nets = comparable.map(netOf).filter((n): n is number => n !== null);
  const bestNet = nets.length ? Math.max(...nets) : null;
  // People the step email can go to: everyone on the listing, plus the seller if only entered in Details
  const emailContacts = [
    ...contacts.map((c) => ({ role: c.role, name: c.name, email: c.email })),
    ...(listing.seller_email && !contacts.some((c) => (c.email || '').toLowerCase() === listing.seller_email!.toLowerCase())
      ? [{ role: 'Seller', name: listing.seller_name, email: listing.seller_email }]
      : []),
  ];
  const converted = listing.status === 'converted' && listing.converted_transaction_id;
  const done = tasks.filter((t) => t.completed).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const today = todayIso();
  const daysToGoLive = listing.planned_list_date ? Math.round((Date.parse(`${listing.planned_list_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null;

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingDetails(true);
    await act(
      () =>
        call('PATCH', `/api/listings/${id}`, {
          propertyAddress: det.propertyAddress,
          agentId: det.agentId || null,
          sellerName: det.sellerName,
          sellerEmail: det.sellerEmail,
          sellerPhone: det.sellerPhone,
          listPrice: det.listPrice,
          plannedListDate: det.plannedListDate || null,
          expirationDate: det.expirationDate || null,
          mlsNumber: det.mlsNumber,
          mlsUrl: det.mlsUrl,
          notes: det.notes,
          shareWithAgent: det.shareWithAgent,
        }),
      'Details saved.',
      true
    );
    setSavingDetails(false);
  };

  const openConvert = (offer: Offer | 'none') => {
    setConvertError('');
    const d = new Date();
    const stamp = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}.${d.getFullYear()}`;
    setConv({
      fileNumber: `FL-${stamp}`,
      acceptanceDate: todayIso(),
      closingDate: offer !== 'none' && offer.closing_date ? offer.closing_date : '',
      price: offer !== 'none' && offer.offer_price ? String(offer.offer_price) : listing.list_price ? String(listing.list_price) : '',
    });
    setConvertOffer(offer);
  };

  const convert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!listing.agent_id) {
      setConvertError('Choose the listing agent in the details first. A deal needs an agent.');
      return;
    }
    setConverting(true);
    setConvertError('');
    let txId: string | null = null;
    try {
      const tx = await call('POST', '/api/transactions', {
        agentId: listing.agent_id,
        fileNumber: conv.fileNumber.trim(),
        propertyAddress: listing.property_address,
        purchasePrice: Number(String(conv.price).replace(/[$,\s]/g, '')) || 0,
        acceptanceDate: conv.acceptanceDate || null,
        closingDate: conv.closingDate || null,
      });
      txId = tx.id as string;

      // Carry the people over. Contacts failing never undoes the deal.
      for (const c of contacts) {
        try {
          await call('POST', `/api/transactions/${txId}/contacts`, { role: c.role || '', name: c.name || '', email: c.email || '', phone: c.phone || '' });
        } catch {
          // One contact failing never undoes the deal.
        }
      }
      // Copy the listing documents onto the deal (best effort, same as the people)
      await call('POST', `/api/listings/${id}/copy-documents`, { transactionId: txId, offerId: convertOffer && convertOffer !== 'none' ? convertOffer.id : undefined }).catch(() => undefined);
      if (convertOffer && convertOffer !== 'none') {
        await call('PATCH', `/api/listings/${id}/offers/${convertOffer.id}`, { status: 'accepted' }).catch(() => undefined);
      }
      await call('PATCH', `/api/listings/${id}`, { convertedTransactionId: txId });
      router.push(`/dashboard/transactions/${txId}`);
    } catch (err) {
      if (handleAuth(err)) return;
      const msg = err instanceof Error ? err.message : 'Could not convert';
      setConvertError(
        txId
          ? `The deal was created, but the last step failed: ${msg}. Open it from your Transactions list.`
          : msg
      );
      setConverting(false);
    }
  };

  const deleteListing = async () => {
    if (!confirm(`Delete the listing for ${listing.property_address}? Its checklist, offers and notes will be removed.`)) return;
    try {
      await call('DELETE', `/api/listings/${id}`);
      router.push('/dashboard/listings');
    } catch (err) {
      if (!handleAuth(err)) setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <Link href="/dashboard/listings" className="text-sm text-slate-400 hover:text-slate-200">
        ← Back to listings
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 break-words">{listing.property_address}</h1>
          <p className="text-sm text-slate-400 mt-1">
            {[listing.seller_name && `Seller: ${listing.seller_name}`, data.agent && `Agent: ${data.agent.name}`, money(listing.list_price)].filter(Boolean).join(' · ')}
          </p>
          <p className="text-sm text-slate-400 mt-1">
            {daysToGoLive !== null && listing.status === 'preparing' && (daysToGoLive >= 0 ? `${daysToGoLive} day${daysToGoLive === 1 ? '' : 's'} to go live` : `${-daysToGoLive} day${daysToGoLive === -1 ? '' : 's'} past the planned list date`)}
            {listing.mls_url ? (
              <>
                {daysToGoLive !== null && listing.status === 'preparing' ? ' · ' : ''}
                <a href={listing.mls_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                  View listing{listing.mls_number ? ` (MLS ${listing.mls_number})` : ''}
                </a>
              </>
            ) : listing.mls_number ? (
              ` · MLS ${listing.mls_number}`
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {converted ? (
            <Link href={`/dashboard/transactions/${listing.converted_transaction_id}`} className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg">
              Open the deal
            </Link>
          ) : (
            <>
              <select
                value={listing.status}
                onChange={(e) => act(() => call('PATCH', `/api/listings/${id}`, { status: e.target.value }))}
                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100"
                aria-label="Listing status"
              >
                {LISTING_STATUSES.filter((s) => s !== 'converted').map((s) => (
                  <option key={s} value={s}>
                    {LISTING_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => openConvert('none')} className="px-4 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg">
                Convert to deal
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {notice && <p className="mb-4 text-sm text-green-400">{notice}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6 min-w-0">
          {/* Checklist */}
          <div className={cardCls}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-bold text-slate-100">Checklist</h2>
              <span className="text-xs text-slate-400">
                {done}/{tasks.length} done
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden mb-4" aria-hidden>
              <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
            </div>
            <ul className="space-y-1">
              {tasks.map((t) => {
                const overdue = !t.completed && t.due_date && t.due_date < today;
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 border-b border-slate-700/50 last:border-0">
                    <input type="checkbox" checked={t.completed} onChange={(e) => act(() => call('PATCH', `/api/listings/${id}/tasks/${t.id}`, { completed: e.target.checked }))} className="accent-blue-500" aria-label={`Mark "${t.name}" done`} />
                    <span className={`flex-1 min-w-[10rem] text-sm break-words ${t.completed ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{t.name}</span>
                    <input
                      type="date"
                      value={t.due_date || ''}
                      onChange={(e) => act(() => call('PATCH', `/api/listings/${id}/tasks/${t.id}`, { dueDate: e.target.value || null }))}
                      className={`bg-transparent border border-slate-700 rounded px-2 py-1 text-xs ${overdue ? 'text-red-300 border-red-700/60' : 'text-slate-400'}`}
                      aria-label={`Due date for ${t.name}`}
                    />
                    <button type="button" onClick={() => setEmailTask(t)} className="text-xs text-blue-400 hover:text-blue-300" aria-label={`Email about ${t.name}`}>
                      Email
                    </button>
                    <button type="button" onClick={() => act(() => call('DELETE', `/api/listings/${id}/tasks/${t.id}`))} className="text-slate-600 hover:text-red-300 text-sm" aria-label={`Remove ${t.name}`}>
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
            <form
              className="mt-3 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newStep.trim()) return;
                if (await act(() => call('POST', `/api/listings/${id}/tasks`, { name: newStep }))) setNewStep('');
              }}
            >
              <input className={inputCls} placeholder="Add a step" value={newStep} onChange={(e) => setNewStep(e.target.value)} maxLength={200} />
              <button type="submit" className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm rounded-lg shrink-0">
                Add
              </button>
            </form>
          </div>

          {/* Offers */}
          <div className={cardCls}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-bold text-slate-100">Offers</h2>
              <button type="button" onClick={() => setIntake('new')} className="text-sm px-3 py-1.5 rounded-lg border border-blue-500/60 text-blue-300 hover:bg-blue-500/10">
                Add offer from PDF
              </button>
            </div>
            {offers.length === 0 && <p className="text-sm text-slate-500 mb-3">No offers logged yet.</p>}
            {comparable.length >= 2 && (
              <div className="mb-4 overflow-x-auto border border-slate-700 rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 uppercase tracking-wider border-b border-slate-700">
                      <th className="px-3 py-2">Buyer</th>
                      <th className="px-3 py-2">Price</th>
                      <th className="px-3 py-2">vs list</th>
                      <th className="px-3 py-2">Net*</th>
                      <th className="px-3 py-2">Financing</th>
                      <th className="px-3 py-2">Earnest</th>
                      <th className="px-3 py-2">Option</th>
                      <th className="px-3 py-2">Closing</th>
                      <th className="px-3 py-2">Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparable.map((o) => {
                      const net = netOf(o);
                      const best = net !== null && net === bestNet;
                      const vs = o.offer_price && listing.list_price ? ((Number(o.offer_price) - Number(listing.list_price)) / Number(listing.list_price)) * 100 : null;
                      return (
                        <tr key={o.id} className="border-b border-slate-700/50 last:border-0 text-slate-300">
                          <td className="px-3 py-2">{o.buyer_name || 'Buyer'}</td>
                          <td className="px-3 py-2">{money(o.offer_price) || '—'}</td>
                          <td className={`px-3 py-2 ${vs === null ? '' : vs >= 0 ? 'text-green-300' : 'text-amber-300'}`}>{vs === null ? '—' : `${vs >= 0 ? '+' : ''}${vs.toFixed(1)}%`}</td>
                          <td className={`px-3 py-2 ${best ? 'text-green-300 font-semibold' : ''}`}>{net !== null ? money(net) : '—'}{best ? ' ★' : ''}</td>
                          <td className="px-3 py-2">{o.financing || '—'}</td>
                          <td className="px-3 py-2">{o.earnest_money ? money(o.earnest_money) : '—'}</td>
                          <td className="px-3 py-2">{o.option_days != null ? `${o.option_days}d` : '—'}</td>
                          <td className="px-3 py-2">{o.closing_date ? formatDisplayDate(o.closing_date) : '—'}</td>
                          <td className="px-3 py-2">{o.offer_expires_at || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="px-3 py-2 text-[11px] text-slate-500">*Net is the offer price minus any seller-paid concessions. It does not include commissions or other closing costs.</p>
              </div>
            )}
            <div className="space-y-3">
              {offers.map((o) => (
                <div key={o.id} className="border border-slate-700 rounded-lg p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-slate-100 font-medium break-words">
                        {o.buyer_name || 'Buyer'} {o.offer_price ? <span className="text-slate-300">· {money(o.offer_price)}</span> : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {[o.buyer_agent && `Agent: ${o.buyer_agent}`, o.received_on && `Received ${formatDisplayDate(o.received_on)}`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <select
                      value={o.status}
                      onChange={(e) => act(() => call('PATCH', `/api/listings/${id}/offers/${o.id}`, { status: e.target.value }))}
                      className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-100"
                      aria-label="Offer status"
                    >
                      {Object.entries(OFFER_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(o.financing || o.earnest_money || o.option_days != null || o.closing_date || o.seller_concessions || o.offer_expires_at || o.possession) && (
                    <p className="text-xs text-slate-400 mt-2">
                      {[
                        o.financing,
                        o.earnest_money ? `Earnest ${money(o.earnest_money)}` : '',
                        o.option_days != null ? `${o.option_days}-day option` : '',
                        o.closing_date ? `Closing ${formatDisplayDate(o.closing_date)}` : '',
                        o.seller_concessions ? `Seller pays ${money(o.seller_concessions)}` : '',
                        o.offer_expires_at ? `Expires ${o.offer_expires_at}` : '',
                        o.possession ? `Possession: ${o.possession}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  {o.contingencies && <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap break-words">Contingencies: {o.contingencies}</p>}
                  {o.terms && <p className="text-sm text-slate-400 mt-2 whitespace-pre-wrap break-words">{o.terms}</p>}
                  <div className="mt-2 flex items-center gap-4 text-sm">
                    {!converted && (o.status === 'received' || o.status === 'countered') && (
                      <button type="button" onClick={() => openConvert(o)} className="text-blue-400 hover:text-blue-300">
                        Accept and convert to deal
                      </button>
                    )}
                    {!converted && (
                      <button type="button" onClick={() => setIntake(o)} className="text-blue-400 hover:text-blue-300">
                        Counteroffer / amendment
                      </button>
                    )}
                    <button type="button" onClick={() => setHistoryOpen(historyOpen === o.id ? null : o.id)} className="text-slate-400 hover:text-slate-200">
                      {historyOpen === o.id ? 'Hide history' : `History${(o.current_version || 1) > 1 ? ` (v${o.current_version})` : ''}`}
                    </button>
                    <button type="button" onClick={() => act(() => call('DELETE', `/api/listings/${id}/offers/${o.id}`))} className="text-slate-500 hover:text-red-300">
                      Remove
                    </button>
                  </div>
                  {historyOpen === o.id && <OfferHistory listingId={id} offerId={o.id} refreshKey={historyKey} />}
                </div>
              ))}
            </div>
            <form
              className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act(() => call('POST', `/api/listings/${id}/offers`, newOffer), 'Offer logged.')) setNewOffer(EMPTY_OFFER);
              }}
            >
              <input className={inputCls} placeholder="Buyer name" value={newOffer.buyerName} onChange={(e) => setNewOffer({ ...newOffer, buyerName: e.target.value })} />
              <input className={inputCls} placeholder="Buyer's agent" value={newOffer.buyerAgent} onChange={(e) => setNewOffer({ ...newOffer, buyerAgent: e.target.value })} />
              <input className={inputCls} placeholder="Offer price" inputMode="decimal" value={newOffer.offerPrice} onChange={(e) => setNewOffer({ ...newOffer, offerPrice: e.target.value })} />
              <input className={inputCls} type="date" value={newOffer.receivedOn} onChange={(e) => setNewOffer({ ...newOffer, receivedOn: e.target.value })} aria-label="Date received" />
              <select className={inputCls} value={newOffer.financing} onChange={(e) => setNewOffer({ ...newOffer, financing: e.target.value })} aria-label="Financing">
                <option value="">Financing (optional)</option>
                {FINANCING_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <input className={inputCls} placeholder="Earnest money" inputMode="decimal" value={newOffer.earnestMoney} onChange={(e) => setNewOffer({ ...newOffer, earnestMoney: e.target.value })} />
              <input className={inputCls} placeholder="Option period (days)" inputMode="numeric" value={newOffer.optionDays} onChange={(e) => setNewOffer({ ...newOffer, optionDays: e.target.value })} />
              <input className={inputCls} placeholder="Seller pays (concessions)" inputMode="decimal" value={newOffer.sellerConcessions} onChange={(e) => setNewOffer({ ...newOffer, sellerConcessions: e.target.value })} />
              <div className="sm:col-span-2">
                <label className={labelCls}>Proposed closing date</label>
                <input className={inputCls} type="date" value={newOffer.closingDate} onChange={(e) => setNewOffer({ ...newOffer, closingDate: e.target.value })} />
              </div>
              <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Other terms and contingencies" value={newOffer.terms} onChange={(e) => setNewOffer({ ...newOffer, terms: e.target.value })} />
              <div className="sm:col-span-2">
                <button type="submit" className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm rounded-lg">
                  Log offer
                </button>
              </div>
            </form>
          </div>

          {/* Showings */}
          <div className={cardCls}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <h2 className="text-lg font-bold text-slate-100">Showings and feedback</h2>
              <span className="text-xs text-slate-400">
                {showings.length} logged{hotCount > 0 ? ` · ${hotCount} very interested` : ''}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-3">Log each showing, open house and broker tour with what the visitor said. Use it in your seller updates and price reviews.</p>
            {showings.length === 0 && <p className="text-sm text-slate-500 mb-3">Nothing logged yet.</p>}
            <ul className="space-y-2 mb-4">
              {showings.map((sh) => (
                <li key={sh.id} className="border border-slate-700 rounded-lg px-3 py-2 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-slate-200 min-w-0 break-words">
                      <span className="font-medium">{formatDisplayDate(sh.showing_date)}</span>
                      <span className="text-slate-500"> · {SHOWING_KIND_LABEL[sh.kind as keyof typeof SHOWING_KIND_LABEL] || 'Showing'}</span>
                      {sh.visitor ? <span className="text-slate-400"> · {sh.visitor}</span> : null}
                      {sh.interest ? <span className={sh.interest === 'hot' ? 'text-green-300' : 'text-slate-400'}> · {SHOWING_INTEREST_LABEL[sh.interest]}</span> : null}
                    </p>
                    <button type="button" onClick={() => act(() => call('DELETE', `/api/listings/${id}/showings/${sh.id}`))} className="text-slate-600 hover:text-red-300 shrink-0" aria-label="Remove showing">
                      ✕
                    </button>
                  </div>
                  {sh.feedback && <p className="text-slate-400 mt-1 whitespace-pre-wrap break-words">{sh.feedback}</p>}
                </li>
              ))}
            </ul>
            <form
              className="grid grid-cols-1 sm:grid-cols-2 gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await act(() => call('POST', `/api/listings/${id}/showings`, { ...newShowing, showingDate: newShowing.showingDate || todayIso() }), 'Logged.');
                if (ok) setNewShowing({ showingDate: '', kind: 'showing', visitor: '', interest: '', feedback: '' });
              }}
            >
              <input className={inputCls} type="date" value={newShowing.showingDate} onChange={(e) => setNewShowing({ ...newShowing, showingDate: e.target.value })} aria-label="Date" />
              <select className={inputCls} value={newShowing.kind} onChange={(e) => setNewShowing({ ...newShowing, kind: e.target.value })} aria-label="Type">
                {Object.entries(SHOWING_KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input className={inputCls} placeholder="Visitor or buyer's agent" value={newShowing.visitor} onChange={(e) => setNewShowing({ ...newShowing, visitor: e.target.value })} />
              <select className={inputCls} value={newShowing.interest} onChange={(e) => setNewShowing({ ...newShowing, interest: e.target.value })} aria-label="Interest">
                <option value="">Interest (optional)</option>
                {Object.entries(SHOWING_INTEREST_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Feedback (price, condition, what they liked)" value={newShowing.feedback} onChange={(e) => setNewShowing({ ...newShowing, feedback: e.target.value })} />
              <div className="sm:col-span-2">
                <button type="submit" className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm rounded-lg">
                  Log showing
                </button>
              </div>
            </form>
          </div>
        </div>

        <div className="space-y-6 min-w-0">
          {/* Details */}
          <form onSubmit={saveDetails} className={`${cardCls} space-y-3`}>
            <h2 className="text-lg font-bold text-slate-100">Details</h2>
            <div>
              <label className={labelCls}>Address</label>
              <input className={inputCls} value={det.propertyAddress} onChange={(e) => setDet({ ...det, propertyAddress: e.target.value })} required />
            </div>
            <div>
              <label className={labelCls}>Listing agent</label>
              <select className={inputCls} value={det.agentId} onChange={(e) => setDet({ ...det, agentId: e.target.value })}>
                <option value="">None yet</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>List price</label>
                <input className={inputCls} inputMode="decimal" value={det.listPrice} onChange={(e) => setDet({ ...det, listPrice: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Planned list date</label>
                <input className={inputCls} type="date" value={det.plannedListDate} onChange={(e) => setDet({ ...det, plannedListDate: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Listing expires</label>
                <input className={inputCls} type="date" value={det.expirationDate} onChange={(e) => setDet({ ...det, expirationDate: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>MLS number</label>
                <input className={inputCls} value={det.mlsNumber} onChange={(e) => setDet({ ...det, mlsNumber: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Listing link</label>
              <input className={inputCls} placeholder="https://" value={det.mlsUrl} onChange={(e) => setDet({ ...det, mlsUrl: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Seller</label>
                <input className={inputCls} value={det.sellerName} onChange={(e) => setDet({ ...det, sellerName: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Seller phone</label>
                <input className={inputCls} value={det.sellerPhone} onChange={(e) => setDet({ ...det, sellerPhone: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Seller email</label>
              <input className={inputCls} type="email" value={det.sellerEmail} onChange={(e) => setDet({ ...det, sellerEmail: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <textarea className={inputCls} rows={3} value={det.notes} onChange={(e) => setDet({ ...det, notes: e.target.value })} />
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={det.shareWithAgent} onChange={(e) => setDet({ ...det, shareWithAgent: e.target.checked })} className="accent-blue-500 mt-1" />
              <span>
                Show this listing to the listing agent in their Relay agent portal
                <span className="block text-xs text-slate-500">Read-only: key dates, offers, showings and price history. They never see your checklist, notes or documents.</span>
              </span>
            </label>
            <button type="submit" disabled={savingDetails} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
              {savingDetails ? 'Saving…' : 'Save details'}
            </button>
            <p className="text-xs text-slate-500">Changing the planned list date moves every unfinished checklist step with it.</p>
          </form>

          {/* Key dates */}
          <div className={cardCls}>
            <h2 className="text-lg font-bold text-slate-100 mb-3">Key dates</h2>
            <ul className="space-y-1 text-sm mb-3">
              {listing.planned_list_date && (
                <li className="flex justify-between gap-3 text-slate-300">
                  <span>Planned list date</span>
                  <span>{formatDisplayDate(listing.planned_list_date)}</span>
                </li>
              )}
              {listing.expiration_date && (
                <li className="flex justify-between gap-3 text-slate-300">
                  <span>Listing expires</span>
                  <span>{formatDisplayDate(listing.expiration_date)}</span>
                </li>
              )}
              {dates.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 text-slate-300">
                  <span className="break-words min-w-0">{d.label}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {formatDisplayDate(d.due_date)}
                    <button type="button" onClick={() => act(() => call('DELETE', `/api/listings/${id}/dates/${d.id}`))} className="text-slate-600 hover:text-red-300" aria-label={`Remove ${d.label}`}>
                      ✕
                    </button>
                  </span>
                </li>
              ))}
              {!listing.planned_list_date && !listing.expiration_date && dates.length === 0 && <li className="text-slate-500">No dates yet.</li>}
            </ul>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act(() => call('POST', `/api/listings/${id}/dates`, newDate))) setNewDate({ label: '', dueDate: '' });
              }}
            >
              <input className={`${inputCls} flex-1 min-w-[8rem]`} placeholder="Open house, price review…" value={newDate.label} onChange={(e) => setNewDate({ ...newDate, label: e.target.value })} maxLength={120} />
              <input className={`${inputCls} w-auto`} type="date" value={newDate.dueDate} onChange={(e) => setNewDate({ ...newDate, dueDate: e.target.value })} aria-label="Date" />
              <button type="submit" disabled={!newDate.label.trim() || !newDate.dueDate} className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm rounded-lg disabled:opacity-50">
                Add
              </button>
            </form>
          </div>

          {/* Documents */}
          <div className={cardCls}>
            <h2 className="text-lg font-bold text-slate-100 mb-1">Documents</h2>
            <p className="text-xs text-slate-500 mb-3">Listing agreement, disclosures, photos. They are copied onto the deal when you convert.</p>
            <ul className="space-y-2 text-sm mb-3">
              {docs.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 break-all">
                        {d.file_name}
                      </a>
                    ) : (
                      <span className="text-slate-300 break-all">{d.file_name}</span>
                    )}
                    <p className="text-xs text-slate-500">
                      {d.document_type}
                      {d.file_size ? ` · ${(d.file_size / 1024 / 1024 >= 1 ? `${(d.file_size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(d.file_size / 1024))} KB`)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Remove ${d.file_name}?`)) return;
                      try {
                        await call('DELETE', `/api/listings/${id}/documents/${d.id}`);
                        await loadDocs();
                      } catch (err) {
                        setDocError(err instanceof Error ? err.message : 'Could not remove');
                      }
                    }}
                    className="text-slate-600 hover:text-red-300 shrink-0"
                    aria-label={`Remove ${d.file_name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
              {docs.length === 0 && <li className="text-slate-500">No documents yet.</li>}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${inputCls} sm:w-auto`} value={docType} onChange={(e) => setDocType(e.target.value)}>
                {LISTING_DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <label className={`px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm rounded-lg cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {uploading ? 'Uploading…' : 'Upload files'}
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    uploadDocs(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {docError && <p className="text-sm text-red-400 mt-2">{docError}</p>}
          </div>

          {/* Contacts */}
          <div className={cardCls}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-bold text-slate-100">People on this listing</h2>
              <ContactPicker
                existingEmails={contacts.map((c) => c.email)}
                onPick={async (c) => {
                  await call('POST', `/api/listings/${id}/contacts`, c);
                  await act(async () => undefined);
                }}
              />
            </div>
            <ul className="space-y-2 text-sm mb-3">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0 text-slate-300">
                    <p className="break-words">
                      <span className="text-slate-100 font-medium">{c.name || c.email || 'Contact'}</span>
                      {c.role ? <span className="text-slate-500"> · {c.role}</span> : null}
                    </p>
                    <p className="text-xs text-slate-500 break-all">{[c.email, c.phone].filter(Boolean).join(' · ')}</p>
                  </div>
                  <button type="button" onClick={() => act(() => call('DELETE', `/api/listings/${id}/contacts/${c.id}`))} className="text-slate-600 hover:text-red-300 shrink-0" aria-label="Remove contact">
                    ✕
                  </button>
                </li>
              ))}
              {contacts.length === 0 && <li className="text-slate-500">Add the seller, photographer, stager and anyone else involved.</li>}
            </ul>
            <form
              className="grid grid-cols-1 sm:grid-cols-2 gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act(() => call('POST', `/api/listings/${id}/contacts`, newContact))) setNewContact({ role: '', name: '', email: '', phone: '' });
              }}
            >
              <input className={inputCls} placeholder="Role (Photographer…)" value={newContact.role} onChange={(e) => setNewContact({ ...newContact, role: e.target.value })} />
              <input className={inputCls} placeholder="Name" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
              <input className={inputCls} placeholder="Email" type="email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
              <input className={inputCls} placeholder="Phone" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} />
              <div className="sm:col-span-2">
                <button type="submit" className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm rounded-lg">
                  Add person
                </button>
              </div>
            </form>
          </div>

          {/* Price history */}
          <div className={cardCls}>
            <h2 className="text-lg font-bold text-slate-100 mb-3">Price history</h2>
            <ul className="space-y-1 text-sm mb-3">
              {priceChanges.length === 0 && <li className="text-slate-500">No price changes yet. {listing.list_price ? `Listed at ${money(listing.list_price)}.` : ''}</li>}
              {priceChanges.map((pc) => (
                <li key={pc.id} className="text-slate-300">
                  <span className="text-slate-500">{formatDisplayDate(pc.changed_on)}</span> · {pc.old_price ? `${money(pc.old_price)} → ` : ''}
                  <span className="font-medium text-slate-100">{money(pc.new_price)}</span>
                  {pc.old_price ? (
                    <span className={Number(pc.new_price) < Number(pc.old_price) ? 'text-amber-300' : 'text-green-300'}>
                      {' '}
                      ({Number(pc.new_price) < Number(pc.old_price) ? '−' : '+'}
                      {money(Math.abs(Number(pc.new_price) - Number(pc.old_price)))})
                    </span>
                  ) : null}
                  {pc.note ? <span className="text-slate-500"> — {pc.note}</span> : null}
                </li>
              ))}
            </ul>
            <form
              className="grid grid-cols-1 sm:grid-cols-[8rem_1fr_auto] gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!priceForm.price.trim()) return;
                const ok = await act(() => call('PATCH', `/api/listings/${id}`, { listPrice: priceForm.price, priceNote: priceForm.note }), 'Price updated.', true);
                if (ok) setPriceForm({ price: '', note: '' });
              }}
            >
              <input className={inputCls} placeholder="New price" inputMode="decimal" value={priceForm.price} onChange={(e) => setPriceForm({ ...priceForm, price: e.target.value })} />
              <input className={inputCls} placeholder="Reason (optional)" value={priceForm.note} onChange={(e) => setPriceForm({ ...priceForm, note: e.target.value })} maxLength={500} />
              <button type="submit" className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm rounded-lg">
                Change price
              </button>
            </form>
          </div>

          {/* History */}
          <div className={cardCls}>
            <h2 className="text-lg font-bold text-slate-100 mb-3">History</h2>
            {activity.length === 0 && <p className="text-sm text-slate-500">Changes to this listing will show up here.</p>}
            <ul className="space-y-1.5 text-sm">
              {(showAllActivity ? activity : activity.slice(0, 8)).map((a) => (
                <li key={a.id} className="text-slate-300 break-words">
                  <span className="text-slate-500 text-xs">{new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span> · {a.summary}
                  {a.actor_label ? <span className="text-slate-600"> ({a.actor_label})</span> : null}
                </li>
              ))}
            </ul>
            {activity.length > 8 && (
              <button type="button" onClick={() => setShowAllActivity(!showAllActivity)} className="mt-2 text-xs text-blue-400 hover:text-blue-300">
                {showAllActivity ? 'Show less' : `Show all ${activity.length}`}
              </button>
            )}
          </div>

          <button type="button" onClick={deleteListing} className="text-sm text-slate-500 hover:text-red-300">
            Delete this listing
          </button>
        </div>
      </div>

      {intake && (
        <OfferIntakeModal
          key={intake === 'new' ? 'new' : intake.id}
          listingId={id}
          offer={intake === 'new' ? null : (intake as unknown as Record<string, unknown>)}
          onClose={() => setIntake(null)}
          onSaved={async (message) => {
            const wasRevision = intake !== 'new';
            setIntake(null);
            setHistoryKey((k) => k + 1);
            if (wasRevision) setHistoryOpen((intake as Offer).id);
            await act(async () => undefined, message);
          }}
        />
      )}

      {emailTask && (
        <StepEmailModal
          key={emailTask.id}
          listingId={id}
          taskId={emailTask.id}
          stepName={emailTask.name}
          stepDueDate={emailTask.due_date}
          propertyAddress={listing.property_address}
          agent={data.agent ? { name: data.agent.name, email: data.agent.email ?? agents.find((a) => a.id === data.agent!.id)?.email ?? null } : null}
          contacts={emailContacts}
          extraVars={{
            seller_name: listing.seller_name || '',
            seller_first_name: (listing.seller_name || '').trim().split(/\s+/)[0] || '',
            list_price: money(listing.list_price),
          }}
          onClose={() => setEmailTask(null)}
        />
      )}

      {convertOffer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <form onSubmit={convert} className="w-full max-w-md bg-slate-800 border border-slate-600 rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-bold text-slate-100">Convert to a deal</h2>
            <p className="text-sm text-slate-400">
              Creates a new transaction for {listing.property_address} with the agent and everyone listed here, and starts your closing checklist from the dates below.
              {convertOffer !== 'none' ? ' The offer is marked accepted.' : ''}
            </p>
            <div>
              <label className={labelCls}>File number</label>
              <input className={inputCls} value={conv.fileNumber} onChange={(e) => setConv({ ...conv, fileNumber: e.target.value })} required />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Accepted on</label>
                <input className={inputCls} type="date" value={conv.acceptanceDate} onChange={(e) => setConv({ ...conv, acceptanceDate: e.target.value })} required />
              </div>
              <div>
                <label className={labelCls}>Closing date</label>
                <input className={inputCls} type="date" value={conv.closingDate} onChange={(e) => setConv({ ...conv, closingDate: e.target.value })} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Sale price</label>
              <input className={inputCls} inputMode="decimal" value={conv.price} onChange={(e) => setConv({ ...conv, price: e.target.value })} />
            </div>
            {convertError && <p className="text-sm text-red-400">{convertError}</p>}
            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={converting || !conv.fileNumber.trim()} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                {converting ? 'Creating the deal…' : 'Create deal'}
              </button>
              <button type="button" onClick={() => setConvertOffer(null)} disabled={converting} className="text-sm text-slate-400 hover:text-slate-200">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
