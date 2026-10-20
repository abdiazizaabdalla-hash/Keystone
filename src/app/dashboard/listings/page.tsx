'use client';

import MoneyInput from '@/components/MoneyInput';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { uploadIncoming, type UploadedFile } from '@/lib/incomingUploadClient';
import { formatDisplayDate } from '@/lib/dueDates';
import { LISTING_STATUS_LABEL, daysOnMarket, type ListingStatus } from '@/lib/listingsShared';

interface ListingRow {
  id: string;
  property_address: string;
  seller_name: string | null;
  list_price: number | null;
  planned_list_date: string | null;
  status: ListingStatus;
  agent_name: string | null;
  tasks_total: number;
  tasks_done: number;
  overdue_count: number;
  next_due_date: string | null;
  open_offers: number;
  listed_on?: string | null;
}
interface AgentOption {
  id: string;
  name: string;
}
interface FoundPerson {
  role: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  include: boolean;
}

const SELLER_ROLE = /seller|owner|trustee|executor|principal/i;
const normName = (v: string) => v.toLowerCase().replace(/[^a-z]/g, '');

const inputCls =
  'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

const STATUS_STYLE: Record<ListingStatus, string> = {
  preparing: 'bg-amber-900/30 text-amber-300 border-amber-700/50',
  active: 'bg-green-900/30 text-green-300 border-green-700/50',
  under_offer: 'bg-blue-900/30 text-blue-300 border-blue-700/50',
  converted: 'bg-slate-700 text-slate-300 border-slate-600',
  expired: 'bg-red-900/30 text-red-300 border-red-700/50',
  withdrawn: 'bg-slate-700 text-slate-400 border-slate-600',
};

const money = (n: number | null) => (n ? `$${Number(n).toLocaleString('en-US')}` : '—');

export default function ListingsPage() {
  const router = useRouter();
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  // The same property is already being listed: offer to open it, or add this one anyway.
  const [dupListing, setDupListing] = useState<{ id: string; message: string } | null>(null);
  const [form, setForm] = useState({
    propertyAddress: '',
    agentId: '',
    sellerName: '',
    sellerEmail: '',
    sellerPhone: '',
    listPrice: '',
    plannedListDate: '',
    notes: '',
    templateName: 'Standard',
  });
  const [templateNames, setTemplateNames] = useState<string[]>(['Standard']);
  // Starting from an uploaded listing agreement
  const [aiAvailable, setAiAvailable] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const agreementUpload = useRef<UploadedFile | null>(null);
  const [reading, setReading] = useState(false);
  const [readMsg, setReadMsg] = useState('');
  const [found, setFound] = useState<FoundPerson[]>([]);

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

  const load = useCallback(async () => {
    try {
      const [lRes, aRes, xRes, tRes] = await Promise.all([
        authFetch('/api/listings'),
        authFetch('/api/agents'),
        authFetch('/api/listings/extract-agreement').catch(() => null),
        authFetch('/api/listing-template').catch(() => null),
      ]);
      if (tRes && tRes.ok) {
        const t = await tRes.json().catch(() => ({}));
        if (Array.isArray(t.names) && t.names.length) setTemplateNames(t.names);
      }
      const l = await lRes.json();
      const a = await aRes.json();
      if (xRes && xRes.ok) setAiAvailable(Boolean((await xRes.json()).available));
      if (!lRes.ok) throw new Error(l.error || 'Failed to load listings');
      setListings(l);
      if (Array.isArray(a)) setAgents(a.map((x: AgentOption) => ({ id: x.id, name: x.name })));
      setError('');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  }, [handleAuth]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const visible = useMemo(
    () => (filter === 'all' ? listings : listings.filter((l) => l.status === 'preparing' || l.status === 'active' || l.status === 'under_offer')),
    [listings, filter]
  );

  const resetNew = () => {
    setForm({ propertyAddress: '', agentId: '', sellerName: '', sellerEmail: '', sellerPhone: '', listPrice: '', plannedListDate: '', notes: '', templateName: 'Standard' });
    setPdfFile(null);
    agreementUpload.current = null;
    setFound([]);
    setReadMsg('');
    setFormError('');
  };

  const readAgreement = async (file: File) => {
    setPdfFile(file);
    setReading(true);
    setReadMsg('');
    setFormError('');
    try {
      // Straight to private storage first (large agreements are fine), then Relay reads it from there.
      const [uploaded] = await uploadIncoming([file]);
      agreementUpload.current = uploaded;
      const res = await authFetch('/api/listings/extract-agreement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploads: [uploaded] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReadMsg(data.error || 'Could not read the agreement.');
        return;
      }
      const f = data.fields || {};
      const people: FoundPerson[] = (Array.isArray(f.people) ? f.people : [])
        .map((p: Record<string, unknown>) => ({
          role: String(p.role || '').trim(),
          name: String(p.name || '').trim(),
          email: String(p.email || '').trim(),
          phone: String(p.phone || '').trim(),
          company: String(p.company || '').trim(),
          include: true,
        }))
        .filter((p: FoundPerson) => p.name || p.email);
      const firstSeller = people.find((p) => SELLER_ROLE.test(p.role));
      // Match the listing agent against the agents already set up
      const agentPerson = people.find((p) => /listing agent|agent|realtor|salesperson/i.test(p.role) && !/broker(age)?$/i.test(p.role));
      const matchedAgent = agentPerson ? agents.find((a) => normName(a.name) === normName(agentPerson.name)) : undefined;
      const noteParts = [
        f.listingType ? `Listing type: ${f.listingType}` : '',
        f.mlsNumber ? `MLS #: ${f.mlsNumber}` : '',
        f.expirationDate ? `Listing expires: ${f.expirationDate}` : '',
        f.commissionSummary ? `Fees: ${f.commissionSummary}` : '',
        f.notes ? `Double-check: ${f.notes}` : '',
      ].filter(Boolean);
      setForm((prev) => ({
        ...prev,
        propertyAddress: prev.propertyAddress || String(f.propertyAddress || ''),
        listPrice: prev.listPrice || (Number(f.listPrice) > 0 ? String(Math.round(Number(f.listPrice))) : ''),
        plannedListDate: prev.plannedListDate || String(f.agreementStartDate || ''),
        sellerName: prev.sellerName || firstSeller?.name || '',
        sellerEmail: prev.sellerEmail || firstSeller?.email || '',
        sellerPhone: prev.sellerPhone || firstSeller?.phone || '',
        agentId: prev.agentId || matchedAgent?.id || '',
        notes: prev.notes || noteParts.join('\n'),
      }));
      // The seller is already in the form fields, so only list everyone else for review
      setFound(people.filter((p) => p !== firstSeller));
      setReadMsg(
        `Read the agreement. Check everything below before creating — ${people.length} ${people.length === 1 ? 'person' : 'people'} found.` +
          (agentPerson && !matchedAgent ? ` The listing agent (${agentPerson.name}) isn't set up in Relay yet, so pick one below.` : '')
      );
    } catch (err) {
      if (handleAuth(err)) return;
      setReadMsg('Could not read the agreement. You can enter the details yourself.');
    } finally {
      setReading(false);
    }
  };

  const create = async (e: React.FormEvent | null, allowDuplicate = false) => {
    e?.preventDefault();
    setFormError('');
    setDupListing(null);
    setSaving(true);
    try {
      const res = await authFetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          allowDuplicate,
          agentId: form.agentId || null,
          contacts: found.filter((p) => p.include).map((p) => ({ role: p.role, name: p.name, email: p.email, phone: p.phone })),
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === 'duplicate_listing') {
        setDupListing({ id: data.existing?.id, message: data.error });
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Failed to create listing');
      // Keep the agreement itself on the listing (best effort — the listing already exists)
      if (pdfFile) {
        try {
          const uploaded = agreementUpload.current ?? (await uploadIncoming([pdfFile]))[0];
          await authFetch(`/api/listings/${data.id}/documents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploads: [uploaded], documentType: 'Listing Agreement' }),
          });
        } catch {
          /* the listing page lets them upload it again */
        }
      }
      router.push(`/dashboard/listings/${data.id}`);
    } catch (err) {
      if (handleAuth(err)) return;
      setFormError(err instanceof Error ? err.message : 'Failed to create listing');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <p className="text-slate-400">Loading listings…</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 mb-1">Listings</h1>
          <p className="text-slate-400">Everything before the contract: prep, go-live, showings and offers. An accepted offer becomes a deal.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/dashboard/listings/template" className="text-sm text-slate-400 hover:text-slate-200">
            Edit default checklist
          </Link>
          <button
            type="button"
            onClick={() => {
              setFormError('');
              setShowNew(true);
            }}
            className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition"
          >
            + New listing
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="mb-4 flex items-center gap-2 text-sm">
        {(['open', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full border ${filter === f ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-slate-600 text-slate-400 hover:text-slate-200'}`}
          >
            {f === 'open' ? 'Open listings' : 'All'}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-8 text-center">
          <p className="text-slate-300 mb-1">{listings.length === 0 ? 'No listings yet.' : 'No open listings.'}</p>
          <p className="text-sm text-slate-500">Start one when a listing agreement is signed. Relay adds the prep checklist and counts the days to your list date.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {visible.map((l) => {
            const pct = l.tasks_total ? Math.round((l.tasks_done / l.tasks_total) * 100) : 0;
            return (
              <Link
                key={l.id}
                href={`/dashboard/listings/${l.id}`}
                className="block bg-slate-800/50 border border-slate-700 hover:border-slate-500 rounded-lg p-4 transition"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-slate-100 font-semibold break-words">{l.property_address}</p>
                    <p className="text-xs text-slate-500">
                      {[l.seller_name && `Seller: ${l.seller_name}`, l.agent_name && `Agent: ${l.agent_name}`, money(l.list_price)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full border ${STATUS_STYLE[l.status] || STATUS_STYLE.preparing}`}>{LISTING_STATUS_LABEL[l.status] || l.status}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
                  <span>
                    {l.tasks_done}/{l.tasks_total} steps done
                  </span>
                  <span className="w-28 h-1.5 rounded-full bg-slate-700 overflow-hidden" aria-hidden>
                    <span className="block h-full bg-blue-500" style={{ width: `${pct}%` }} />
                  </span>
                  {l.planned_list_date && <span>List date {formatDisplayDate(l.planned_list_date)}</span>}
                  {(l.status === 'active' || l.status === 'under_offer') && daysOnMarket(l.listed_on) !== null && <span>{daysOnMarket(l.listed_on)} days on market</span>}
                  {l.overdue_count > 0 && <span className="text-red-300">{l.overdue_count} overdue</span>}
                  {l.open_offers > 0 && (
                    <span className="text-blue-300">
                      {l.open_offers} open offer{l.open_offers === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <form onSubmit={create} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-800 border border-slate-600 rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-bold text-slate-100">New listing</h2>
            {aiAvailable && (
              <div className="rounded-lg border border-dashed border-slate-600 bg-slate-900/40 p-3">
                <p className="text-sm font-semibold text-slate-200">Start from the listing agreement</p>
                <p className="text-xs text-slate-400 mt-0.5 mb-2">
                  Upload the signed PDF and Relay fills in the address, price, dates and everyone named on it. You review before anything is saved.
                </p>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={reading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readAgreement(f);
                    e.target.value = '';
                  }}
                  className="block w-full text-xs text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-slate-700 file:text-slate-100 file:text-xs"
                />
                {reading && <p className="text-xs text-blue-300 mt-2">Reading {pdfFile?.name}… this takes about 15–30 seconds.</p>}
                {!reading && readMsg && <p className="text-xs text-slate-300 mt-2">{readMsg}</p>}
                {!reading && pdfFile && <p className="text-xs text-slate-500 mt-1">{pdfFile.name} will be saved on the listing under Documents.</p>}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Property address *</label>
              <input className={inputCls} placeholder="123 Main St, Austin, TX 78701" value={form.propertyAddress} onChange={(e) => setForm({ ...form, propertyAddress: e.target.value })} required autoFocus />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Listing agent *</label>
              <select className={inputCls} value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
                <option value="">Choose the agent who holds this listing</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">The agent the listing belongs to. They are also the agent on the deal if you convert it.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Seller name</label>
                <input className={inputCls} placeholder="Full name" value={form.sellerName} onChange={(e) => setForm({ ...form, sellerName: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Seller email</label>
                <input className={inputCls} placeholder="name@email.com" type="email" value={form.sellerEmail} onChange={(e) => setForm({ ...form, sellerEmail: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Seller phone</label>
                <input className={inputCls} placeholder="(512) 555-0123" value={form.sellerPhone} onChange={(e) => setForm({ ...form, sellerPhone: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">List price</label>
                <MoneyInput className={inputCls} placeholder="450,000" aria-label="List price" value={form.listPrice} onValueChange={(v) => setForm({ ...form, listPrice: v })} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Planned list date</label>
              <input className={inputCls} type="date" value={form.plannedListDate} onChange={(e) => setForm({ ...form, plannedListDate: e.target.value })} />
              <p className="text-xs text-slate-500 mt-1">Checklist due dates count back and forward from this day, and move if you change it.</p>
            </div>
            {templateNames.length > 1 && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Checklist to start with</label>
                <select className={inputCls} value={form.templateName} onChange={(e) => setForm({ ...form, templateName: e.target.value })}>
                  {templateNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.notes && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Notes</label>
                <textarea className={inputCls} rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            )}
            {found.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Other people on the agreement</label>
                <div className="space-y-1.5">
                  {found.map((p, i) => (
                    <label key={i} className="flex items-start gap-2 rounded-lg bg-slate-700/40 border border-slate-600/60 px-3 py-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={p.include}
                        onChange={(e) => setFound((prev) => prev.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))}
                      />
                      <span className="text-sm text-slate-200 min-w-0">
                        <span className="font-medium">{p.name || p.email}</span>
                        <span className="text-slate-400"> · {p.role || 'Contact'}</span>
                        {(p.email || p.phone) && <span className="block text-xs text-slate-400 truncate">{[p.email, p.phone].filter(Boolean).join(' · ')}</span>}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-1">Checked people are added to the listing and saved to your Contacts.</p>
              </div>
            )}
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            {dupListing && (
              <div className="rounded-lg border border-amber-700/60 bg-amber-900/20 p-3 text-sm">
                <p className="text-amber-200">{dupListing.message} Is this the same one?</p>
                <div className="flex flex-wrap gap-3 mt-2">
                  {dupListing.id && (
                    <Link href={`/dashboard/listings/${dupListing.id}`} className="px-3 py-1.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-xs font-semibold rounded-lg">
                      Open the existing listing
                    </Link>
                  )}
                  <button type="button" onClick={() => create(null, true)} disabled={saving} className="px-3 py-1.5 text-xs font-semibold text-amber-200 border border-amber-700/60 rounded-lg hover:bg-amber-900/30 disabled:opacity-50">
                    It&apos;s different, add it anyway
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={saving} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                {saving ? 'Creating…' : 'Create listing'}
              </button>
              <button type="button" onClick={() => { setShowNew(false); resetNew(); }} className="text-sm text-slate-400 hover:text-slate-200">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
