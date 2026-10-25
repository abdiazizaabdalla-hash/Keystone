'use client';

import MoneyInput from '@/components/MoneyInput';
import PhoneInput from '@/components/PhoneInput';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { uploadIncoming } from '@/lib/incomingUploadClient';
import DragHandle from '@/components/DragHandle';
import MoveMenu from '@/components/MoveMenu';
import { isDocDrag, isFileDrag, readDocDrag, startDocDrag } from '@/lib/docDrag';
import { formatDisplayDate } from '@/lib/dueDates';
import ContactPicker from '@/components/ContactPicker';
import StepEmailModal from '@/components/StepEmailModal';
import OfferIntakeModal from '@/components/OfferIntakeModal';
import OfferHistory from '@/components/OfferHistory';
import ListingThread from '@/components/ListingThread';
import OverviewSection from '@/components/OverviewSection';
import SellerUpdateModal from '@/components/SellerUpdateModal';
import ListingReadinessCard from '@/components/ListingReadinessCard';
import ListingSignModal, { type ListingSigningRequest } from '@/components/ListingSignModal';
import { computeReadiness } from '@/lib/listingReadiness';
import { suggestFileNumber } from '@/lib/fileNumber';
import {
  FINANCING_TYPES,
  LISTING_STATUS_LABEL,
  LISTING_STATUSES,
  LISTING_DOC_TYPES,
  SHOWING_INTEREST_LABEL,
  SHOWING_KIND_LABEL,
  daysBetween,
  daysOnMarket,
  mentionsEscalation,
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
  notify_agent?: boolean | null;
  inbound_token?: string | null;
  listed_on?: string | null;
  docs_not_needed?: string[] | null;
  tc_user_id?: string;
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
interface Contact { id: string; role: string | null; name: string | null; email: string | null; phone: string | null; added_by_agent?: boolean | null }
interface DateRow { id: string; label: string; due_date: string }
interface InboundItem {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: string;
  files: { name: string; size: number }[];
}
interface Detail {
  listing: Listing;
  assignees?: { id: string; label: string }[];
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
  'w-full bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';
const labelCls = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5';
interface ListingDoc {
  id: string;
  file_name: string;
  document_type: string;
  file_size: number | null;
  created_at: string;
  url: string | null;
  is_signed?: boolean | null;
}

const cardCls = 'bg-white/5 border border-white/10 rounded-2xl p-5 md:p-6';
// Loose check that two addresses start with the same street number (used only to warn about a wrong contract).
function sameStreetNumber(a: string, b: string): boolean {
  const num = (x: string) => (x.trim().match(/^\d+/) || [''])[0];
  const na = num(a);
  const nb = num(b);
  return !na || !nb || na === nb;
}

const OFFER_LABEL: Record<string, string> = { received: 'Received', countered: 'Countered', accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Withdrawn' };
const money = (n: number | null) => (n ? `$${Number(n).toLocaleString('en-US')}` : '');
const todayIso = () => new Date().toISOString().slice(0, 10);

type ListingTab = 'overview' | 'checklist' | 'offers' | 'documents' | 'messages' | 'details';
const LISTING_TABS: { id: ListingTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'offers', label: 'Offers & showings' },
  { id: 'documents', label: 'Documents' },
  { id: 'messages', label: 'Messages' },
  { id: 'details', label: 'Details' },
];

export default function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState<ListingTab>('overview');
  const selectTab = (next: ListingTab) => {
    setTab(next);
    try {
      window.history.replaceState(null, '', `#${next}`);
    } catch {
      /* non-fatal */
    }
  };
  useEffect(() => {
    const h = window.location.hash.replace('#', '');
    if (LISTING_TABS.some((t) => t.id === h)) setTab(h as ListingTab);
  }, []);
  const [data, setData] = useState<Detail | null>(null);
  const [agents, setAgents] = useState<{ id: string; name: string; email?: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Details form
  const [det, setDet] = useState({ propertyAddress: '', agentId: '', sellerName: '', sellerEmail: '', sellerPhone: '', listPrice: '', plannedListDate: '', expirationDate: '', mlsNumber: '', mlsUrl: '', notes: '', shareWithAgent: true, notifyAgent: false, listedOn: '', tcUserId: '' });
  const [savingDetails, setSavingDetails] = useState(false);
  // Has the listing's agent been given a portal login? (the listing only shows in their portal once they can sign in)
  const [portal, setPortal] = useState<{ hasAgent: boolean; agentName: string | null; agentEmail: string | null; shared: boolean; invitedAt: string | null; visibleToAgent?: boolean; lookupError?: string | null; login?: 'none' | 'agent' | 'other' | 'unknown'; listingStatus?: string | null } | null>(null);
  const [invitingPortal, setInvitingPortal] = useState(false);
  const [portalMsg, setPortalMsg] = useState('');

  // Add forms
  const [newStep, setNewStep] = useState('');
  const EMPTY_OFFER = { buyerName: '', buyerAgent: '', offerPrice: '', receivedOn: '', terms: '', financing: '', earnestMoney: '', optionDays: '', closingDate: '', sellerConcessions: '' };
  const [newOffer, setNewOffer] = useState(EMPTY_OFFER);
  const [emailTask, setEmailTask] = useState<Task | null>(null);
  // Renaming a checklist step in place
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // Offer intake: 'new' = from documents, an Offer = counteroffer/amendment for it
  const [intake, setIntake] = useState<'new' | Offer | null>(null);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [newShowing, setNewShowing] = useState({ showingDate: '', kind: 'showing', visitor: '', interest: '', feedback: '' });
  const [priceForm, setPriceForm] = useState({ price: '', note: '' });
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showPriceHistory, setShowPriceHistory] = useState(false);
  const [newDate, setNewDate] = useState({ label: '', dueDate: '' });
  const [newContact, setNewContact] = useState({ role: '', name: '', email: '', phone: '' });

  // Documents
  const [docs, setDocs] = useState<ListingDoc[]>([]);
  const [signReqs, setSignReqs] = useState<ListingSigningRequest[]>([]);
  const [signingDoc, setSigningDoc] = useState<ListingDoc | null>(null);
  const [docType, setDocType] = useState('General');
  const [uploading, setUploading] = useState(false);
  // Which area an upload is going into, and which areas are folded away (same idea as a deal's Documents).
  const docInputRef = useRef<HTMLInputElement>(null);
  const pendingDocType = useRef<string>('General');
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);
  const [collapsedDocs, setCollapsedDocs] = useState<Record<string, boolean>>({});
  const triggerDocUpload = (type: string) => {
    pendingDocType.current = type;
    if (docInputRef.current) docInputRef.current.value = '';
    docInputRef.current?.click();
  };
  const [docError, setDocError] = useState('');

  // Offer emails held for review, seller update, relist
  const [inbound, setInbound] = useState<InboundItem[]>([]);
  const [intakeInitial, setIntakeInitial] = useState<{ inboundId: string; files: { name: string; path: string; url: string | null }[] } | undefined>(undefined);
  const [openingInbound, setOpeningInbound] = useState<string | null>(null);
  const [sellerUpdate, setSellerUpdate] = useState(false);
  const [relistOpen, setRelistOpen] = useState(false);
  const [relistForm, setRelistForm] = useState({ plannedListDate: '', listPrice: '', templateName: 'Standard' });
  const [templateNames, setTemplateNames] = useState<string[]>(['Standard']);
  const [relisting, setRelisting] = useState(false);
  const [relistError, setRelistError] = useState('');
  const [deadline, setDeadline] = useState('');
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [tcName, setTcName] = useState('');

  // Convert modal
  const [convertOffer, setConvertOffer] = useState<Offer | 'none' | null>(null);
  const [conv, setConv] = useState({ fileNumber: '', acceptanceDate: '', closingDate: '', price: '' });
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState('');
  // Deal details read from a contract (nothing is saved until "Create deal")
  interface DealRead {
    fileName: string;
    propertyAddress: string;
    dates: { kind: string; label: string; dueDate: string }[];
    contacts: { role: string; name: string; email?: string; phone?: string }[];
    notes: string;
  }
  const [dealRead, setDealRead] = useState<DealRead | null>(null);
  const [reading, setReading] = useState('');
  const [readError, setReadError] = useState('');
  const [offerDocs, setOfferDocs] = useState<{ id: string; file_name: string; doc_kind: string }[]>([]);
  const [inviteAgent, setInviteAgent] = useState(true);
  const [dealCreated, setDealCreated] = useState<{ txId: string; notes: string[] } | null>(null);

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
      notifyAgent: l.notify_agent === true,
      listedOn: l.listed_on || '',
      tcUserId: l.tc_user_id || '',
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
    try {
      const r = await call('GET', `/api/signing-requests?listingId=${id}`);
      if (Array.isArray(r)) setSignReqs(r);
    } catch {
      // Signing may not be set up yet (add-listing-esign.sql); the documents then show no signature status.
    }
  }, [id, call]);

  const loadInbound = useCallback(async () => {
    try {
      const r = await call('GET', `/api/listings/${id}/inbound-offers`);
      setInbound(Array.isArray(r.items) ? r.items : []);
    } catch {
      // The table may not exist yet on a fresh setup; the banner then simply stays hidden.
    }
  }, [id, call]);

  const loadPortal = useCallback(async () => {
    try {
      setPortal(await call('GET', `/api/listings/${id}/invite-agent`));
    } catch {
      setPortal(null);
    }
  }, [id, call]);

  useEffect(() => {
    const t = setTimeout(() => {
      load();
      loadDocs();
      loadInbound();
      loadPortal();
    }, 0);
    return () => clearTimeout(t);
  }, [load, loadDocs, loadInbound, loadPortal]);

  const invitePortal = async () => {
    setInvitingPortal(true);
    setPortalMsg('');
    try {
      await call('POST', `/api/listings/${id}/invite-agent`);
      setPortalMsg('Invite sent.');
      await loadPortal();
    } catch (err) {
      if (!handleAuth(err)) setPortalMsg(err instanceof Error ? err.message : 'Could not send the invite');
    } finally {
      setInvitingPortal(false);
    }
  };

  const reviewInbound = async (item: InboundItem) => {
    setOpeningInbound(item.id);
    setError('');
    try {
      const r = await call('POST', `/api/listings/${id}/inbound-offers/${item.id}/stage`);
      setIntakeInitial({ inboundId: item.id, files: r.files });
      setIntake('new');
    } catch (err) {
      if (!handleAuth(err)) setError(err instanceof Error ? err.message : 'Could not open that email');
    } finally {
      setOpeningInbound(null);
    }
  };

  const dismissInbound = async (item: InboundItem) => {
    if (!confirm('Dismiss this email? Its attachments are deleted from Relay.')) return;
    try {
      await call('DELETE', `/api/listings/${id}/inbound-offers/${item.id}`);
      await loadInbound();
    } catch (err) {
      if (!handleAuth(err)) setError(err instanceof Error ? err.message : 'Could not dismiss');
    }
  };

  const openSellerUpdate = async () => {
    // The draft is signed with the coordinator's name, so fetch it before the window opens.
    if (!tcName) {
      try {
        const me = await authFetch('/api/auth/me');
        if (me.ok) setTcName((await me.json()).fullName || '');
      } catch {
        /* the draft is signed generically */
      }
    }
    setSellerUpdate(true);
  };

  const openRelist = async () => {
    setRelistError('');
    setRelistForm({ plannedListDate: '', listPrice: data?.listing.list_price ? String(data.listing.list_price) : '', templateName: 'Standard' });
    setRelistOpen(true);
    try {
      const t = await call('GET', '/api/listing-template');
      if (Array.isArray(t.names) && t.names.length) setTemplateNames(t.names);
    } catch {
      /* the default checklist is used */
    }
  };

  const relist = async (e: React.FormEvent) => {
    e.preventDefault();
    setRelisting(true);
    setRelistError('');
    try {
      const created = await call('POST', `/api/listings/${id}/relist`, { ...relistForm, plannedListDate: relistForm.plannedListDate || null });
      router.push(`/dashboard/listings/${created.id}`);
    } catch (err) {
      if (!handleAuth(err)) setRelistError(err instanceof Error ? err.message : 'Could not relist');
      setRelisting(false);
    }
  };

  const moveDoc = async (docId: string, documentType: string) => {
    const current = docs.find((d) => d.id === docId);
    if (!current || current.document_type === documentType) return;
    setDocError('');
    // Show the move straight away; the re-read below settles it (and undoes it if it failed).
    setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, document_type: documentType } : d)));
    try {
      await call('PATCH', `/api/listings/${id}/documents/${docId}`, { documentType });
    } catch (err) {
      if (!handleAuth(err)) setDocError(err instanceof Error ? err.message : 'Could not move that document');
      await loadDocs(); // put the list back the way the server has it
    }
  };

  const uploadDocs = async (files: FileList | null, typeOverride?: string) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadTarget(typeOverride || docType);
    setDocError('');
    try {
      for (const file of Array.from(files)) {
        const [uploaded] = await uploadIncoming([file]);
        const res = await authFetch(`/api/listings/${id}/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploads: [uploaded], documentType: typeOverride || docType }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${file.name}: ${json.error || 'upload failed'}`);
      }
      await loadDocs();
    } catch (err) {
      if (!handleAuth(err)) setDocError(err instanceof Error ? err.message : 'Upload failed');
      await loadDocs();
    } finally {
      setUploading(false);
      setUploadTarget(null);
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

  // Checklist changes show instantly (no waiting on the server and a full reload of the page). If the server
  // says no, the page is reloaded from it so what you see is what is saved.
  const quickTasks = async (next: (tasks: Task[]) => Task[], req: () => Promise<unknown>, okMsg?: string) => {
    setError('');
    setData((d) => (d ? { ...d, tasks: next(d.tasks) } : d));
    try {
      await req();
      if (okMsg) flash(okMsg);
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Something went wrong');
      try {
        applyDetail(await call('GET', `/api/listings/${id}`));
      } catch {
        /* the error above is enough */
      }
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
  // Why a listing does or doesn't show in the agent's portal, in plain words, with the fix next to it.
  const resendAction = portal?.agentEmail ? { label: invitingPortal ? 'Sending…' : 'Resend invite', run: () => void invitePortal() } : undefined;
  const portalStatus: { ok: boolean; text: string; action?: { label: string; run: () => void } } = !data.agent
    ? { ok: false, text: "No listing agent is chosen, so this listing can't appear in anyone's agent portal.", action: { label: 'Choose an agent', run: () => selectTab('details') } }
    : !portal
      ? { ok: false, text: 'Checking the agent portal…' }
      : !portal.agentEmail
        ? { ok: false, text: `${data.agent.name} has no email on file, so there is no portal login to show this listing in.`, action: { label: 'Fix on the Agents page', run: () => router.push('/dashboard/agents') } }
        : !portal.shared
          ? { ok: false, text: 'Sharing with the agent is off, so the agent cannot see this listing.', action: { label: 'Turn it on in Details', run: () => selectTab('details') } }
          : portal.lookupError
            ? { ok: false, text: `The agent portal could not load listings (${portal.lookupError}). A database update is probably missing: run add-listing-extras.sql and add-listing-agent-access.sql in Supabase.` }
            : portal.listingStatus === 'withdrawn'
              ? { ok: false, text: 'This listing is marked withdrawn, and withdrawn listings are hidden from the agent portal.', action: { label: 'Change status in Details', run: () => selectTab('details') } }
              : portal.login === 'none'
                ? { ok: false, text: `${portal.agentEmail} has no Relay login yet, so there is nothing for them to sign in to. Send the portal invite.`, action: { label: invitingPortal ? 'Sending…' : 'Send portal invite', run: () => void invitePortal() } }
                : portal.login === 'other'
                  ? { ok: false, text: `${portal.agentEmail} is already a coordinator login, not an agent login, so it cannot open the agent portal. Put a different email on the agent record, then send the invite.`, action: { label: 'Fix on the Agents page', run: () => router.push('/dashboard/agents') } }
                  : portal.visibleToAgent === false
                    ? { ok: false, text: `${portal.agentEmail} has a login, but this listing is not coming back for it. Check that the agent record's email matches the email they sign in with exactly, and that this listing's agent is that record.`, action: { label: 'Check the Agents page', run: () => router.push('/dashboard/agents') } }
                    : { ok: true, text: `${data.agent.name} can see this listing in their portal under Listings (signing in as ${portal.agentEmail}).`, action: resendAction };
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
  const offerDeadline = dates.find((d) => /^offers?\s+due/i.test(d.label)) || null;
  const inboundDomain = process.env.NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN;
  const inboundAddress = inboundDomain && listing.inbound_token ? `listing-${listing.inbound_token}@${inboundDomain}` : null;
  const converted = listing.status === 'converted' && listing.converted_transaction_id;
  const done = tasks.filter((t) => t.completed).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const today = todayIso();
  const daysToGoLive = listing.planned_list_date ? Math.round((Date.parse(`${listing.planned_list_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null;

  // Where a document stands in e-signing: the newest request for it (a multi-signer request is several rows).
  const isPdfDoc = (d: ListingDoc) => d.file_name.toLowerCase().endsWith('.pdf');
  const signStatusFor = (d: ListingDoc): { text: string; tone: string; voidId?: string } | null => {
    if (d.is_signed) return { text: '✓ Signed', tone: 'text-green-300' };
    const mine = signReqs.filter((r) => r.listing_document_id === d.id);
    if (mine.length === 0) return null;
    const newest = mine[0]; // the list is newest first
    const group = newest.group_id ? mine.filter((r) => r.group_id === newest.group_id) : [newest];
    const ordered = [...group].sort((a, b) => (a.signing_order || 1) - (b.signing_order || 1));
    const pending = ordered.filter((r) => r.status === 'pending');
    const signedCount = ordered.filter((r) => r.status === 'signed').length;
    if (pending.length > 0) {
      const next = pending[0];
      return {
        text: ordered.length > 1 ? `Awaiting signature · signed ${signedCount} of ${ordered.length} · waiting on ${next.signer_name}` : `Awaiting signature from ${next.signer_name}`,
        tone: 'text-blue-300',
        voidId: next.id,
      };
    }
    if (ordered.some((r) => r.status === 'declined')) return { text: 'Signer declined', tone: 'text-amber-300' };
    if (ordered.some((r) => r.status === 'voided')) return { text: 'Signature request voided', tone: 'text-slate-500' };
    return null;
  };
  const voidSigning = async (requestId: string) => {
    if (!confirm('Void this signature request? The link will stop working and you can send a new one.')) return;
    try {
      await call('PATCH', `/api/signing-requests/${requestId}`, { action: 'void' });
      await loadDocs();
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Could not void the request');
    }
  };

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
          notifyAgent: det.notifyAgent,
          listedOn: det.listedOn || null,
          ...(det.tcUserId && det.tcUserId !== listing.tc_user_id ? { tcUserId: det.tcUserId } : {}),
        }),
      'Details saved.',
      true
    );
    setSavingDetails(false);
    loadPortal();
  };

  // Reads a contract that is already on the listing (or on the offer) and fills the deal form from it.
  const readContract = async (source: 'listing' | 'offer', documentId: string) => {
    setReading(documentId);
    setReadError('');
    try {
      const r = await call('POST', `/api/listings/${id}/extract-deal`, { source, documentId });
      setConv((c) => ({
        ...c,
        acceptanceDate: r.acceptanceDate || c.acceptanceDate,
        closingDate: r.closingDate || c.closingDate,
        price: r.price ? String(r.price) : c.price,
      }));
      setDealRead({ fileName: r.fileName, propertyAddress: r.propertyAddress || '', dates: r.dates || [], contacts: r.contacts || [], notes: r.notes || '' });
    } catch (err) {
      if (!handleAuth(err)) setReadError(err instanceof Error ? err.message : 'Could not read that contract');
    } finally {
      setReading('');
    }
  };

  const openConvert = async (offer: Offer | 'none') => {
    setConvertError('');
    setDealRead(null);
    setReadError('');
    setOfferDocs([]);
    setDealCreated(null);
    const agentEmail = agents.find((a) => a.id === listing.agent_id)?.email;
    setInviteAgent(Boolean(agentEmail));
    setConv({
      fileNumber: suggestFileNumber(new Date(), []),
      acceptanceDate: todayIso(),
      closingDate: offer !== 'none' && offer.closing_date ? offer.closing_date : '',
      price: offer !== 'none' && offer.offer_price ? String(offer.offer_price) : listing.list_price ? String(listing.list_price) : '',
    });
    setConvertOffer(offer);

    // File number: today's date, numbered when you already started a deal today.
    authFetch('/api/transactions')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        const numbers = Array.isArray(list) ? list.map((t: { file_number?: string }) => t.file_number || '') : [];
        setConv((c) => ({ ...c, fileNumber: suggestFileNumber(new Date(), numbers) }));
      })
      .catch(() => undefined);

    // Pick the best contract already on file and read it: the offer's own purchase contract first, then a listing
    // document filed as a Purchase Contract.
    let pick: { source: 'listing' | 'offer'; id: string } | null = null;
    if (offer !== 'none') {
      try {
        const v = await call('GET', `/api/listings/${id}/offers/${offer.id}/versions`);
        const od = (Array.isArray(v.documents) ? v.documents : []).filter((d: { file_name: string }) => d.file_name.toLowerCase().endsWith('.pdf'));
        setOfferDocs(od);
        const contract = od.find((d: { doc_kind: string }) => d.doc_kind === 'purchase_contract');
        if (contract) pick = { source: 'offer', id: contract.id };
      } catch {
        // No offer documents to offer; the form still works by hand.
      }
    }
    if (!pick) {
      const own = docs.find((d) => d.document_type === 'Purchase Contract' && d.file_name.toLowerCase().endsWith('.pdf'));
      if (own) pick = { source: 'listing', id: own.id };
    }
    if (pick) await readContract(pick.source, pick.id);
  };

  // Upload a contract right from the convert step: it is kept on the listing as a Purchase Contract, then read.
  const uploadContractAndRead = async (file: File | undefined) => {
    if (!file) return;
    setReadError('');
    setReading('uploading');
    try {
      const [uploaded] = await uploadIncoming([file]);
      const row = await call('POST', `/api/listings/${id}/documents`, { uploads: [uploaded], documentType: 'Purchase Contract' });
      await loadDocs();
      await readContract('listing', row.id as string);
    } catch (err) {
      if (!handleAuth(err)) setReadError(err instanceof Error ? err.message : 'Could not upload that file');
      setReading('');
    }
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
        fromListingId: id,
        // The agent portal invite is sent with the deal (the server skips it when the agent has no email).
        inviteAgent: inviteAgent && Boolean(agents.find((a) => a.id === listing.agent_id)?.email),
      });
      txId = tx.id as string;
      const notes: string[] = [];
      if (tx.agentInvite === 'failed') {
        notes.push(`The agent portal invite to ${agents.find((a) => a.id === listing.agent_id)?.email || 'the agent'} did not go out. You can send it from the deal.`);
      }

      // Carry the people over. Contacts failing never undoes the deal.
      for (const c of contacts) {
        try {
          await call('POST', `/api/transactions/${txId}/contacts`, { role: c.role || '', name: c.name || '', email: c.email || '', phone: c.phone || '' });
        } catch {
          // One contact failing never undoes the deal.
        }
      }
      // People the contract named (buyer, lender, title) that are not already on the listing.
      if (dealRead) {
        const have = new Set(contacts.map((c) => `${(c.role || '').toLowerCase()}|${(c.name || '').toLowerCase()}`));
        for (const c of dealRead.contacts) {
          if (have.has(`${c.role.toLowerCase()}|${c.name.toLowerCase()}`)) continue;
          try {
            await call('POST', `/api/transactions/${txId}/contacts`, { role: c.role, name: c.name, email: c.email || '', phone: c.phone || '' });
          } catch {
            // Same as above.
          }
        }
        // The contract's deadlines become the deal's critical dates.
        const dates = dealRead.dates.filter((d) => d.dueDate);
        if (dates.length > 0) {
          try {
            await call('POST', `/api/transactions/${txId}/key-dates`, { dates: dates.map((d) => ({ kind: d.kind, label: d.label, dueDate: d.dueDate, source: 'contract' })) });
          } catch {
            notes.push('The contract dates could not be added. Add them under Critical dates on the deal.');
          }
        }
      }
      // Copy the listing documents onto the deal (best effort, same as the people)
      await call('POST', `/api/listings/${id}/copy-documents`, { transactionId: txId, offerId: convertOffer && convertOffer !== 'none' ? convertOffer.id : undefined }).catch(() => undefined);
      if (convertOffer && convertOffer !== 'none') {
        await call('PATCH', `/api/listings/${id}/offers/${convertOffer.id}`, { status: 'accepted' }).catch(() => undefined);
      }
      await call('PATCH', `/api/listings/${id}`, { convertedTransactionId: txId });

      if (notes.length > 0) {
        setDealCreated({ txId, notes });
        setConverting(false);
        return;
      }
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
    <div className="p-4 md:p-10 max-w-5xl mx-auto">
      <Link href="/dashboard/listings" className="text-sm text-slate-400 hover:text-slate-200">
        ← Back to listings
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <span
            className={`inline-block px-2.5 py-1 mb-2 rounded-full text-xs font-semibold border ${
              listing.status === 'active'
                ? 'bg-green-500/10 text-green-300 border-green-500/40'
                : listing.status === 'under_offer'
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/40'
                  : 'bg-blue-500/15 text-blue-300 border-blue-500/50'
            }`}
          >
            {LISTING_STATUS_LABEL[listing.status as keyof typeof LISTING_STATUS_LABEL] || listing.status}
          </span>
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 break-words">{listing.property_address}</h1>
          <p className="text-sm text-slate-400 mt-1">
            {[listing.seller_name && `Seller: ${listing.seller_name}`, data.agent && `Agent: ${data.agent.name}`].filter(Boolean).join(' · ')}
          </p>
          {money(listing.list_price) && <p className="text-2xl font-display text-blue-400 mt-1">{money(listing.list_price)}</p>}
          <p className="text-sm text-slate-400 mt-1">
            {(listing.status === 'active' || listing.status === 'under_offer') && daysOnMarket(listing.listed_on) !== null && (
              <span>
                {daysOnMarket(listing.listed_on)} day{daysOnMarket(listing.listed_on) === 1 ? '' : 's'} on market
                {listing.mls_url || listing.mls_number ? ' · ' : ''}
              </span>
            )}
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
            <Link href={`/dashboard/transactions/${listing.converted_transaction_id}`} className="px-4 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg">
              Open the deal
            </Link>
          ) : (
            <>
              <select
                value={listing.status}
                onChange={(e) => act(() => call('PATCH', `/api/listings/${id}`, { status: e.target.value }))}
                className="bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100"
                aria-label="Listing status"
              >
                {LISTING_STATUSES.filter((s) => s !== 'converted').map((s) => (
                  <option key={s} value={s}>
                    {LISTING_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              {(listing.status === 'expired' || listing.status === 'withdrawn') && (
                <button type="button" onClick={openRelist} className="px-4 py-2.5 border border-blue-500/60 text-blue-300 hover:bg-blue-500/10 text-sm font-semibold rounded-lg">
                  Relist
                </button>
              )}
              <button type="button" onClick={openSellerUpdate} className="px-4 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg">
                Update seller
              </button>
              <button type="button" onClick={() => openConvert('none')} className="px-4 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg">
                Convert to deal
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {notice && <p className="mb-4 text-sm text-green-400">{notice}</p>}

      {/* Tabs: one focused section at a time. Panels stay mounted (just hidden) so nothing is lost on switch. */}
      <div role="tablist" aria-label="Listing sections" className="flex gap-1 overflow-x-auto mb-8 p-1 bg-white/5 border border-white/10 rounded-2xl">
        {LISTING_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => selectTab(t.id)}
            className={`px-4 md:px-5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
              tab === t.id ? 'bg-blue-500 text-white shadow' : 'text-slate-300 hover:bg-white/5 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        <div className={tab === 'overview' ? 'space-y-3' : 'hidden'}>
          <div className={`rounded-2xl border p-5 ${portalStatus.ok ? 'bg-green-500/5 border-green-500/30' : 'bg-amber-500/5 border-amber-500/30'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-100">{portalStatus.ok ? 'Visible to your agent' : 'Not visible to your agent yet'}</p>
                <p className="text-sm text-slate-400 mt-0.5">{portalStatus.text}</p>
                {portalMsg && <p className="text-xs text-slate-400 mt-1">{portalMsg}</p>}
              </div>
              {portalStatus.action && (
                <button
                  type="button"
                  onClick={portalStatus.action.run}
                  disabled={invitingPortal}
                  className="shrink-0 px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
                >
                  {portalStatus.action.label}
                </button>
              )}
            </div>
          </div>

          <OverviewSection title="Key dates" defaultOpen summary={[listing.planned_list_date ? `List ${formatDisplayDate(listing.planned_list_date, { month: 'short', day: 'numeric' })}` : null, listing.expiration_date ? `Expires ${formatDisplayDate(listing.expiration_date, { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · ')}>
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
          </OverviewSection>

          {/* Ready to list: what is still missing before go-live */}
          {['preparing', 'active'].includes(listing.status) && (
            <ListingReadinessCard
              listing={listing}
              agentName={data.agent?.name ?? null}
              docs={docs}
              tasks={tasks}
              dates={dates}
              onWaive={(docsNotNeeded) => void act(() => call('PATCH', `/api/listings/${id}`, { docsNotNeeded }))}
            />
          )}


          <OverviewSection
            title="Checklist"
            summary={tasks.length === 0 ? 'No steps yet' : `${tasks.filter((t) => t.completed).length} of ${tasks.length} done`}
            action={{ label: 'Open checklist', onClick: () => selectTab('checklist') }}
          >
            {tasks.filter((t) => !t.completed).length === 0 ? (
              <p className="text-sm text-slate-400">Every step is done.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {tasks.filter((t) => !t.completed).slice(0, 5).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="text-slate-200 truncate">{t.name}</span>
                    <span className="text-slate-500 shrink-0">{t.due_date ? formatDisplayDate(t.due_date, { month: 'short', day: 'numeric' }) : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </OverviewSection>

          <OverviewSection
            title="Offers"
            summary={offers.length === 0 ? 'No offers yet' : `${offers.length} offer${offers.length === 1 ? '' : 's'}${offers.some((o) => o.status === 'received' || o.status === 'countered') ? ' · some still open' : ''}`}
            action={{ label: 'Open offers', onClick: () => selectTab('offers') }}
          >
            {offers.length === 0 ? (
              <p className="text-sm text-slate-400">Offers you add or forward in will show here.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {offers.slice(0, 5).map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="text-slate-200 truncate">{o.buyer_name || 'Buyer'}</span>
                    <span className="text-slate-400 shrink-0">{money(o.offer_price) || '—'} · {o.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </OverviewSection>

          <OverviewSection
            title="Showings"
            summary={showings.length === 0 ? 'None yet' : `${showings.length} showing${showings.length === 1 ? '' : 's'}${hotCount > 0 ? ` · ${hotCount} hot` : ''}`}
            action={{ label: 'Open showings', onClick: () => selectTab('offers') }}
          >
            {showings.length === 0 ? (
              <p className="text-sm text-slate-400">Showings and open houses you log will show here.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {showings.slice(0, 5).map((sh) => (
                  <li key={sh.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="text-slate-200 truncate">{sh.visitor || sh.kind || 'Showing'}</span>
                    <span className="text-slate-500 shrink-0">{sh.showing_date ? formatDisplayDate(sh.showing_date, { month: 'short', day: 'numeric' }) : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </OverviewSection>

          <OverviewSection
            title="Documents"
            summary={`${docs.length} file${docs.length === 1 ? '' : 's'}`}
            action={{ label: 'Open documents', onClick: () => selectTab('documents') }}
          >
            {docs.length === 0 ? (
              <p className="text-sm text-slate-400">No documents yet.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {docs.slice(0, 5).map((d) => (
                  <li key={d.id} className="py-2.5 text-sm text-slate-200 truncate">📄 {d.file_name}</li>
                ))}
              </ul>
            )}
          </OverviewSection>

          <OverviewSection
            title="People"
            summary={contacts.length === 0 ? 'None yet' : `${contacts.length} on this listing`}
            action={{ label: 'Open details', onClick: () => selectTab('details') }}
          >
            {contacts.length === 0 ? (
              <p className="text-sm text-slate-400">Sellers and other people you add show here.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {contacts.filter((c) => c.name || c.email).slice(0, 6).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="text-slate-200 truncate">{c.name || c.email}</span>
                    <span className="text-slate-500 shrink-0">{c.role || ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </OverviewSection>
        </div>

        <div className={tab === 'messages' ? '' : 'hidden'}>
          {data.agent && listing.share_with_agent !== false ? (
            <ListingThread endpoint={`/api/listings/${id}/comments`} self="tc" otherLabel={data.agent.name} />
          ) : (
            <div className={cardCls}>
              <h2 className="text-lg font-bold text-slate-100 mb-1">Messages</h2>
              <p className="text-sm text-slate-400">Choose a listing agent and turn on sharing in Details to message them here.</p>
            </div>
          )}
        </div>

        <div className={tab === 'checklist' ? 'space-y-6' : 'hidden'}>
          {/* Checklist */}
          <div className={cardCls}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-bold text-slate-100">Checklist</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">
                  {done}/{tasks.length} done
                </span>
                {tasks.length > 0 &&
                  (done < tasks.length ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(`Mark all ${tasks.length - done} open step${tasks.length - done === 1 ? '' : 's'} as done?`)) return;
                        void quickTasks((ts) => ts.map((x) => ({ ...x, completed: true })), () => call('POST', `/api/listings/${id}/checklist`, { action: 'complete_all' }), 'All steps marked done.');
                      }}
                      className="text-xs px-2.5 py-1 border border-slate-600 hover:border-blue-500 text-slate-300 hover:text-blue-300 rounded-lg transition"
                    >
                      Mark all done
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void quickTasks((ts) => ts.map((x) => ({ ...x, completed: false })), () => call('POST', `/api/listings/${id}/checklist`, { action: 'reopen_all' }), 'All steps reopened.')}
                      className="text-xs px-2.5 py-1 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 rounded-lg transition"
                    >
                      Reopen all
                    </button>
                  ))}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden mb-4" aria-hidden>
              <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
            </div>
            <ul className="space-y-1">
              {tasks.map((t, idx) => {
                const overdue = !t.completed && t.due_date && t.due_date < today;
                const move = (dir: -1 | 1) => {
                  const ids = tasks.map((x) => x.id);
                  const j = idx + dir;
                  if (j < 0 || j >= ids.length) return;
                  [ids[idx], ids[j]] = [ids[j], ids[idx]];
                  void quickTasks((ts) => ids.map((tid) => ts.find((x) => x.id === tid)).filter((x): x is Task => !!x), () => call('POST', `/api/listings/${id}/checklist`, { action: 'reorder', ids }));
                };
                const saveRename = () => {
                  const next = renaming && renaming.id === t.id ? renaming.name.trim() : '';
                  setRenaming(null);
                  if (next && next !== t.name) void quickTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, name: next } : x)), () => call('PATCH', `/api/listings/${id}/tasks/${t.id}`, { name: next }));
                };
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 border-b border-slate-700/50 last:border-0">
                    <input type="checkbox" checked={t.completed} onChange={(e) => { const checked = e.target.checked; void quickTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, completed: checked } : x)), () => call('PATCH', `/api/listings/${id}/tasks/${t.id}`, { completed: checked })); }} className="accent-blue-500" aria-label={`Mark "${t.name}" done`} />
                    {renaming && renaming.id === t.id ? (
                      <input
                        autoFocus
                        value={renaming.name}
                        maxLength={200}
                        onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
                        onBlur={saveRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            saveRename();
                          } else if (e.key === 'Escape') setRenaming(null);
                        }}
                        className={`${inputCls} flex-1 min-w-[10rem] !py-1 text-sm`}
                        aria-label={`Rename ${t.name}`}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRenaming({ id: t.id, name: t.name })}
                        title="Click to rename"
                        className={`flex-1 min-w-[10rem] text-left text-sm break-words hover:text-blue-300 ${t.completed ? 'text-slate-500 line-through' : 'text-slate-200'}`}
                      >
                        {t.name}
                      </button>
                    )}
                    <input
                      type="date"
                      value={t.due_date || ''}
                      onChange={(e) => { const due = e.target.value || null; void quickTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, due_date: due } : x)), () => call('PATCH', `/api/listings/${id}/tasks/${t.id}`, { dueDate: due })); }}
                      className={`bg-transparent border border-slate-700 rounded px-2 py-1 text-xs ${overdue ? 'text-red-300 border-red-700/60' : 'text-slate-400'}`}
                      aria-label={`Due date for ${t.name}`}
                    />
                    <button type="button" onClick={() => setEmailTask(t)} className="text-xs text-blue-400 hover:text-blue-300" aria-label={`Email about ${t.name}`}>
                      Email
                    </button>
                    <span className="flex items-center">
                      <button type="button" onClick={() => move(-1)} disabled={idx === 0} className="px-1 text-slate-600 hover:text-slate-200 disabled:opacity-20 disabled:hover:text-slate-600 text-xs" aria-label={`Move ${t.name} up`}>
                        ↑
                      </button>
                      <button type="button" onClick={() => move(1)} disabled={idx === tasks.length - 1} className="px-1 text-slate-600 hover:text-slate-200 disabled:opacity-20 disabled:hover:text-slate-600 text-xs" aria-label={`Move ${t.name} down`}>
                        ↓
                      </button>
                    </span>
                    <button type="button" onClick={() => void quickTasks((ts) => ts.filter((x) => x.id !== t.id), () => call('DELETE', `/api/listings/${id}/tasks/${t.id}`))} className="text-slate-600 hover:text-red-300 text-sm" aria-label={`Remove ${t.name}`}>
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
                const name = newStep.trim();
                setNewStep('');
                setError('');
                try {
                  const row = (await call('POST', `/api/listings/${id}/tasks`, { name })) as Task;
                  setData((d) => (d ? { ...d, tasks: [...d.tasks, row] } : d));
                } catch (err) {
                  if (handleAuth(err)) return;
                  setNewStep(name);
                  setError(err instanceof Error ? err.message : 'Something went wrong');
                }
              }}
            >
              <input className={inputCls} placeholder="Add a step" value={newStep} onChange={(e) => setNewStep(e.target.value)} maxLength={200} />
              <button type="submit" className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm rounded-lg shrink-0">
                Add
              </button>
            </form>
            <p className="mt-3 text-xs text-slate-500">
              Click a step to rename it, use the arrows to reorder.{' '}
              <Link href="/dashboard/listings/template" className="text-blue-400 hover:text-blue-300">
                Edit your default checklist
              </Link>{' '}
              for new listings.
            </p>
          </div>

        </div>

        <div className={tab === 'offers' ? 'space-y-6' : 'hidden'}>
          {/* Offers */}
          <div className={cardCls}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-bold text-slate-100">Offers</h2>
              <button type="button" onClick={() => setIntake('new')} className="text-sm px-3 py-1.5 rounded-lg border border-blue-500/60 text-blue-300 hover:bg-blue-500/10">
                Add offer from PDF
              </button>
            </div>
            {inbound.length > 0 && (
              <div className="mb-4 rounded-lg border border-blue-500/40 bg-blue-500/10 p-3 space-y-2">
                <p className="text-sm font-semibold text-blue-200">
                  {inbound.length} offer email{inbound.length === 1 ? '' : 's'} waiting for review
                </p>
                <p className="text-[11px] text-slate-400">The sender name is read from the email and is not verified. Check the documents before you rely on them.</p>
                {inbound.map((item) => (
                  <div key={item.id} className="text-sm text-slate-200">
                    <p className="break-words">
                      <span className="font-medium">{item.fromName || item.fromEmail}</span>
                      {item.subject ? <span className="text-slate-400"> · {item.subject}</span> : null}
                    </p>
                    <p className="text-xs text-slate-400">
                      {item.files.length} file{item.files.length === 1 ? '' : 's'} · {new Date(item.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {item.snippet ? ` · ${item.snippet.slice(0, 140)}` : ''}
                    </p>
                    <div className="mt-1 flex items-center gap-4 text-sm">
                      <button type="button" disabled={openingInbound === item.id} onClick={() => reviewInbound(item)} className="text-blue-300 hover:text-blue-200 disabled:opacity-50">
                        {openingInbound === item.id ? 'Opening…' : 'Review and add'}
                      </button>
                      <button type="button" onClick={() => dismissInbound(item)} className="text-slate-400 hover:text-slate-200">
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {offerDeadline ? (
              <p className={`text-sm mb-3 ${offerDeadline.due_date < today ? 'text-slate-400' : 'text-amber-300'}`}>
                {offerDeadline.label}: {formatDisplayDate(offerDeadline.due_date)}
                {offerDeadline.due_date >= today ? ` (${daysBetween(today, offerDeadline.due_date) === 0 ? 'today' : `in ${daysBetween(today, offerDeadline.due_date)} day${daysBetween(today, offerDeadline.due_date) === 1 ? '' : 's'}`})` : ' (passed)'}
                {' · '}
                <button type="button" onClick={() => act(() => call('DELETE', `/api/listings/${id}/dates/${offerDeadline.id}`))} className="text-slate-500 hover:text-red-300">
                  Clear
                </button>
              </p>
            ) : (
              !converted && (
                <form
                  className="flex flex-wrap items-center gap-2 mb-3"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!deadline) return;
                    if (await act(() => call('POST', `/api/listings/${id}/dates`, { label: 'Offers due', dueDate: deadline }), 'Offer deadline set.')) setDeadline('');
                  }}
                >
                  <label className="text-xs text-slate-500" htmlFor="offer-deadline">
                    Reviewing offers on a set day?
                  </label>
                  <input id="offer-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={`${inputCls} !w-auto`} />
                  <button type="submit" disabled={!deadline} className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-40">
                    Set offer deadline
                  </button>
                </form>
              )
            )}
            {offers.length === 0 && <p className="text-sm text-slate-500 mb-3">No offers logged yet.</p>}
            {comparable.length >= 2 && (
              <button
                type="button"
                onClick={() => setShowCompare(!showCompare)}
                aria-expanded={showCompare}
                className="mb-3 px-3 py-1.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm rounded-lg"
              >
                {showCompare ? 'Hide comparison' : `Compare offers (${comparable.length})`}
              </button>
            )}
            {comparable.length >= 2 && showCompare && (
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
                        {mentionsEscalation(o.terms) && (
                          <span className="ml-2 align-middle text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30" title="The terms mention an escalation clause. Read the contract for the cap.">
                            Escalation clause
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        {[o.buyer_agent && `Agent: ${o.buyer_agent}`, o.received_on && `Received ${formatDisplayDate(o.received_on)}`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <select
                      value={o.status}
                      onChange={(e) => act(() => call('PATCH', `/api/listings/${id}/offers/${o.id}`, { status: e.target.value }))}
                      className="bg-slate-800/70 border border-white/10 rounded-xl px-2 py-1 text-xs text-slate-100"
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
              <MoneyInput className={inputCls} placeholder="Offer price" aria-label="Offer price" value={newOffer.offerPrice} onValueChange={(v) => setNewOffer({ ...newOffer, offerPrice: v })} />
              <input className={inputCls} type="date" value={newOffer.receivedOn} onChange={(e) => setNewOffer({ ...newOffer, receivedOn: e.target.value })} aria-label="Date received" />
              <select className={inputCls} value={newOffer.financing} onChange={(e) => setNewOffer({ ...newOffer, financing: e.target.value })} aria-label="Financing">
                <option value="">Financing (optional)</option>
                {FINANCING_TYPES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <MoneyInput className={inputCls} placeholder="Earnest money" aria-label="Earnest money" value={newOffer.earnestMoney} onValueChange={(v) => setNewOffer({ ...newOffer, earnestMoney: v })} />
              <input className={inputCls} placeholder="Option period (days)" inputMode="numeric" value={newOffer.optionDays} onChange={(e) => setNewOffer({ ...newOffer, optionDays: e.target.value })} />
              <MoneyInput className={inputCls} placeholder="Seller pays (concessions)" aria-label="Seller pays (concessions)" value={newOffer.sellerConcessions} onValueChange={(v) => setNewOffer({ ...newOffer, sellerConcessions: v })} />
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

        <div className={tab === 'documents' ? 'grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start' : 'hidden'}>
          {/* Documents */}
          <div className={cardCls}>
            <input
              ref={docInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void uploadDocs(e.target.files, pendingDocType.current);
                e.target.value = '';
              }}
            />
            <h2 className="text-2xl font-bold text-slate-100 mb-2">Documents</h2>
            <p className="text-sm text-slate-400 mb-6">Organized by area, like a deal. Upload into an area, or drag files from your computer or documents between areas. The signed purchase contract goes under Purchase Contract and fills in the deal when you convert. Everything here is copied onto the deal.</p>
            <div className="space-y-3 mb-3">
              {LISTING_DOC_TYPES.map((type) => {
                const inType = docs.filter((d) => d.document_type === type);
                return (
                  <div
                    key={type}
                    onDragOver={(e) => {
                      if (!isDocDrag(e) && !isFileDrag(e)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = isDocDrag(e) ? 'move' : 'copy';
                      e.currentTarget.classList.add('doc-drop-over');
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.classList.remove('doc-drop-over');
                    }}
                    onDrop={(e) => {
                      e.currentTarget.classList.remove('doc-drop-over');
                      if (isDocDrag(e)) {
                        e.preventDefault();
                        const docId = readDocDrag(e);
                        if (docId) void moveDoc(docId, type);
                      } else if (isFileDrag(e)) {
                        e.preventDefault();
                        void uploadDocs(e.dataTransfer.files, type);
                      }
                    }}
                    className="border rounded-xl overflow-hidden bg-white/5 border-white/10"
                  >
                    <div className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/5 transition">
                      <button
                        type="button"
                        onClick={() => setCollapsedDocs((prev) => ({ ...prev, [type]: !prev[type] }))}
                        aria-expanded={!collapsedDocs[type]}
                        className="flex-1 flex items-center justify-between text-left min-w-0"
                      >
                        <span className="font-semibold text-slate-200">{type}</span>
                        <span className="flex items-center gap-2 text-xs text-slate-400 ml-3">
                          {inType.length} document{inType.length === 1 ? '' : 's'}
                          <svg className={`w-4 h-4 transition-transform ${collapsedDocs[type] ? '' : 'rotate-180'}`} fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerDocUpload(type)}
                        disabled={uploading}
                        className="flex-shrink-0 text-xs px-2.5 py-1 border border-white/10 hover:border-blue-500 text-slate-300 hover:text-blue-300 rounded-lg transition disabled:opacity-50"
                      >
                        {uploading && uploadTarget === type ? 'Uploading…' : '+ Upload'}
                      </button>
                    </div>
                    {!collapsedDocs[type] && (
                    <div className="px-4 pb-4">
                    <ul className="space-y-2 text-sm">
                      {inType.map((d) => (
                        <li
                          key={d.id}
                          draggable
                          onDragStart={(e) => startDocDrag(e, d.id)}
                          className="flex items-start gap-3 cursor-grab active:cursor-grabbing bg-slate-800/50 border border-white/10 rounded-xl px-3 py-2.5"
                        >
                          <DragHandle label={`Drag ${d.file_name} to another area`} />
                          <div className="min-w-0 flex-1">
                            {d.url ? (
                              <a href={d.url} target="_blank" rel="noopener noreferrer" draggable={false} className="text-blue-400 hover:text-blue-300 break-all">
                                {d.file_name}
                              </a>
                            ) : (
                              <span className="text-slate-300 break-all">{d.file_name}</span>
                            )}
                            {(() => {
                              const status = signStatusFor(d);
                              if (!status) return null;
                              return (
                                <p className={`text-xs mt-0.5 ${status.tone}`}>
                                  {status.text}
                                  {status.voidId && (
                                    <button type="button" onClick={() => voidSigning(status.voidId as string)} className="ml-2 text-slate-400 hover:text-red-300 underline">
                                      Void
                                    </button>
                                  )}
                                </p>
                              );
                            })()}
                            <p className="text-xs text-slate-500">
                              {d.file_size ? (d.file_size / 1024 / 1024 >= 1 ? `${(d.file_size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(d.file_size / 1024))} KB`) : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isPdfDoc(d) && !d.is_signed && !signStatusFor(d)?.voidId && (
                              <button
                                type="button"
                                onClick={() => setSigningDoc(d)}
                                className="text-xs px-2 py-1 border border-slate-600 hover:border-blue-500 text-slate-300 hover:text-blue-300 rounded-lg transition"
                              >
                                Request signature
                              </button>
                            )}
                            <MoveMenu
                              onMove={(t) => void moveDoc(d.id, t)}
                              label={`Move ${d.file_name} to another area`}
                              options={LISTING_DOC_TYPES.filter((t) => t !== type).map((t) => ({ value: t, label: t }))}
                            />
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
                              className="text-slate-600 hover:text-red-300"
                              aria-label={`Remove ${d.file_name}`}
                            >
                              ✕
                            </button>
                          </div>
                        </li>
                      ))}
                      {inType.length === 0 && <li className="text-sm text-slate-500 italic">Nothing here yet. Upload or drag a file onto this area.</li>}
                    </ul>
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
            {docError && <p className="text-sm text-red-400 mt-2">{docError}</p>}
          </div>
          <div className="space-y-6 min-w-0">
          {/* Communication -- offer emails forwarded to this listing's own address wait for review in the Offers card;
              the address itself lives down here, like the deal page. Hidden until the inbound domain is configured. */}
          {inboundAddress && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h2 className="text-lg font-bold text-slate-100 mb-1">Communication</h2>
              <p className="text-xs text-slate-400 mb-3">
                Forward or CC offer emails for this listing here and they’ll wait in the Offers card for you to review. Nothing becomes an offer until you add it.
              </p>
              <div className="flex items-center gap-2 mb-2">
                <code className="flex-1 min-w-0 truncate bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-xs text-blue-300">{inboundAddress}</code>
                <button
                  type="button"
                  className="flex-shrink-0 px-3 py-2 text-xs border border-slate-600 hover:border-slate-500 text-slate-300 rounded-lg transition"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inboundAddress);
                      setCopiedAddr(true);
                      setTimeout(() => setCopiedAddr(false), 2000);
                    } catch {
                      setNotice('Couldn’t copy automatically. Select the address and copy it by hand.');
                    }
                  }}
                >
                  {copiedAddr ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-slate-500">{inbound.length === 0 ? 'No offer emails waiting.' : `${inbound.length} offer email${inbound.length === 1 ? '' : 's'} waiting in the Offers card.`}</p>
            </div>
          )}
          </div>
        </div>

        <div className={tab === 'details' ? 'space-y-6' : 'hidden'}>
      {/* Key details at the top, like the transaction page. These inputs belong to the "More details" form below
          (form="listing-details"), so one Save covers both. */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 md:p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelCls}>Address</label>
            <input form="listing-details" className={inputCls} value={det.propertyAddress} onChange={(e) => setDet({ ...det, propertyAddress: e.target.value })} required />
          </div>
          <div>
            <label className={labelCls}>Listing agent</label>
            <select form="listing-details" className={inputCls} value={det.agentId} onChange={(e) => setDet({ ...det, agentId: e.target.value })}>
              <option value="">None yet</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>List price</label>
            <MoneyInput form="listing-details" className={inputCls} aria-label="List price" value={det.listPrice} onValueChange={(v) => setDet({ ...det, listPrice: v })} />
          </div>
          <div>
            <label className={labelCls}>Planned list date</label>
            <input form="listing-details" className={inputCls} type="date" value={det.plannedListDate} onChange={(e) => setDet({ ...det, plannedListDate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Listing expires</label>
            <input form="listing-details" className={inputCls} type="date" value={det.expirationDate} onChange={(e) => setDet({ ...det, expirationDate: e.target.value })} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="submit" form="listing-details" disabled={savingDetails} className="px-5 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
            {savingDetails ? 'Saving…' : 'Save details'}
          </button>
          <p className="text-xs text-slate-500">Changing the planned list date moves every unfinished checklist step with it.</p>
        </div>
      </div>

          {/* Details */}
          <form id="listing-details" onSubmit={saveDetails} className={`${cardCls} space-y-3`}>
            <h2 className="text-lg font-bold text-slate-100">More details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>MLS number</label>
                <input className={inputCls} value={det.mlsNumber} onChange={(e) => setDet({ ...det, mlsNumber: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>On the market since</label>
                <input className={inputCls} type="date" value={det.listedOn} onChange={(e) => setDet({ ...det, listedOn: e.target.value })} />
                <p className="text-[11px] text-slate-500 mt-1">Set automatically when the listing goes active. Change it if it went live earlier.</p>
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
                <PhoneInput className={inputCls} value={det.sellerPhone} onValueChange={(v) => setDet({ ...det, sellerPhone: v })} />
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
                <span className="block text-xs text-slate-500">Read-only: key dates, checklist, offers, showings, price history, documents and contacts. They can add their own contacts. Your private notes are never shared.</span>
              </span>
            </label>
            {portal?.hasAgent && (
              <div className="rounded-lg border border-slate-600 bg-slate-800/50 px-3 py-2.5 text-sm">
                <p className="text-slate-200 font-medium">Agent portal login</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {!portal.agentEmail
                    ? `${portal.agentName || 'The agent'} has no email on file, so they can't be invited. Add one to the agent.`
                    : !portal.shared
                      ? 'Sharing is off, so this listing is hidden from the agent.'
                      : portal.invitedAt
                        ? `Invited ${new Date(portal.invitedAt).toLocaleDateString()} at ${portal.agentEmail}. They sign in with that email and see this listing under Listings.`
                        : `Not invited yet. They need a login with ${portal.agentEmail} before this listing shows in their portal.`}
                </p>
                {portal.agentEmail && portal.shared && (
                  <div className="mt-2 flex items-center gap-3">
                    <button type="button" onClick={invitePortal} disabled={invitingPortal} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-semibold rounded-lg disabled:opacity-50">
                      {invitingPortal ? 'Sending…' : portal.invitedAt ? 'Resend invite' : 'Send portal invite'}
                    </button>
                    {portalMsg && <span className="text-xs text-slate-400">{portalMsg}</span>}
                  </div>
                )}
                {portalMsg && !(portal.agentEmail && portal.shared) && <p className="text-xs text-slate-400 mt-1">{portalMsg}</p>}
              </div>
            )}
            <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={det.notifyAgent} disabled={!det.shareWithAgent || !det.agentId} onChange={(e) => setDet({ ...det, notifyAgent: e.target.checked })} className="accent-blue-500 mt-1" />
              <span>
                Email the listing agent when an offer or showing is logged
                <span className="block text-xs text-slate-500">The email only says something new is waiting and links to their portal. It never contains offer terms. Needs the agent to have an email and the setting above on.</span>
              </span>
            </label>
            {(data.assignees?.length ?? 0) > 1 && (
              <div>
                <label className={labelCls}>Handled by</label>
                <select className={inputCls} value={det.tcUserId} onChange={(e) => setDet({ ...det, tcUserId: e.target.value })}>
                  {data.assignees!.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">Handing it over moves the listing to that teammate (and its calendar reminders to their calendar).</p>
              </div>
            )}
            <button type="submit" disabled={savingDetails} className="px-5 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
              {savingDetails ? 'Saving…' : 'Save details'}
            </button>
          </form>

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
                      {c.added_by_agent ? <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300">Added by agent</span> : null}
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
              <PhoneInput className={inputCls} placeholder="Phone" value={newContact.phone} onValueChange={(v) => setNewContact({ ...newContact, phone: v })} />
              <div className="sm:col-span-2">
                <button type="submit" className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm rounded-lg">
                  Add person
                </button>
              </div>
            </form>
          </div>

          {/* Price history */}
          <div className={cardCls}>
            <button
              type="button"
              onClick={() => setShowPriceHistory(!showPriceHistory)}
              aria-expanded={showPriceHistory}
              className="w-full flex items-center justify-between gap-3 text-left mb-3"
            >
              <h2 className="text-lg font-bold text-slate-100">
                Price history <span className="text-sm font-normal text-slate-500">({priceChanges.length})</span>
              </h2>
              <span className="text-xs text-slate-400">{showPriceHistory ? 'Hide' : 'Show'}</span>
            </button>
            {showPriceHistory && (
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
            )}
            <form
              className="grid grid-cols-1 sm:grid-cols-[8rem_1fr_auto] gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!priceForm.price.trim()) return;
                const ok = await act(() => call('PATCH', `/api/listings/${id}`, { listPrice: priceForm.price, priceNote: priceForm.note }), 'Price updated.', true);
                if (ok) setPriceForm({ price: '', note: '' });
              }}
            >
              <MoneyInput className={inputCls} placeholder="New price" aria-label="New price" value={priceForm.price} onValueChange={(v) => setPriceForm({ ...priceForm, price: v })} />
              <input className={inputCls} placeholder="Reason (optional)" value={priceForm.note} onChange={(e) => setPriceForm({ ...priceForm, note: e.target.value })} maxLength={500} />
              <button type="submit" className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm rounded-lg">
                Change price
              </button>
            </form>
          </div>

          {/* History (hidden until opened) */}
          <div className={cardCls}>
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              aria-expanded={showHistory}
              className="w-full flex items-center justify-between gap-3 text-left"
            >
              <h2 className="text-lg font-bold text-slate-100">
                History <span className="text-sm font-normal text-slate-500">({activity.length})</span>
              </h2>
              <span className="text-xs text-slate-400">{showHistory ? 'Hide' : 'Show'}</span>
            </button>
            {showHistory && (
              <div className="mt-3">
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
            )}
          </div>

          <button type="button" onClick={deleteListing} className="text-sm text-slate-500 hover:text-red-300">
            Delete this listing
          </button>
        </div>
      </div>

      {signingDoc && (
        <ListingSignModal
          doc={{ id: signingDoc.id, file_name: signingDoc.file_name, url: signingDoc.url }}
          seller={{ name: listing.seller_name, email: listing.seller_email }}
          people={emailContacts}
          onClose={() => setSigningDoc(null)}
          onSent={async () => {
            setSigningDoc(null);
            await loadDocs();
            await act(async () => undefined, 'Sent for signature.');
          }}
        />
      )}

      {sellerUpdate && (
        <SellerUpdateModal
          listingId={id}
          tcName={tcName}
          listing={listing}
          showings={showings}
          offers={offers}
          priceChanges={priceChanges}
          dates={dates}
          missingDocs={computeReadiness({ listing, docs, tasks }).missingDocs}
          contacts={contacts}
          onClose={() => setSellerUpdate(false)}
          onSent={async () => {
            setSellerUpdate(false);
            await act(async () => undefined, 'Update sent to the seller.');
          }}
        />
      )}

      {relistOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <form onSubmit={relist} className="w-full max-w-md bg-slate-800 border border-slate-600 rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-bold text-slate-100">Relist this property</h2>
            <p className="text-sm text-slate-400">Starts a new listing for {listing.property_address} with the same seller, agent and people, and a fresh checklist. This listing stays as it is, with its offers and history.</p>
            <div>
              <label className={labelCls}>New planned list date</label>
              <input className={inputCls} type="date" value={relistForm.plannedListDate} onChange={(e) => setRelistForm({ ...relistForm, plannedListDate: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>List price</label>
              <MoneyInput className={inputCls} aria-label="List price" value={relistForm.listPrice} onValueChange={(v) => setRelistForm({ ...relistForm, listPrice: v })} />
            </div>
            {templateNames.length > 1 && (
              <div>
                <label className={labelCls}>Checklist</label>
                <select className={inputCls} value={relistForm.templateName} onChange={(e) => setRelistForm({ ...relistForm, templateName: e.target.value })}>
                  {templateNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {relistError && <p className="text-sm text-red-400">{relistError}</p>}
            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={relisting} className="px-5 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                {relisting ? 'Creating…' : 'Create new listing'}
              </button>
              <button type="button" onClick={() => setRelistOpen(false)} disabled={relisting} className="text-sm text-slate-400 hover:text-slate-200">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {intake && (
        <OfferIntakeModal
          key={intake === 'new' ? `new-${intakeInitial?.inboundId ?? ''}` : intake.id}
          listingId={id}
          offer={intake === 'new' ? null : (intake as unknown as Record<string, unknown>)}
          initial={intake === 'new' ? intakeInitial : undefined}
          onClose={() => {
            setIntake(null);
            setIntakeInitial(undefined);
          }}
          onSaved={async (message) => {
            const wasRevision = intake !== 'new';
            setIntake(null);
            setIntakeInitial(undefined);
            loadInbound();
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true">
          {dealCreated ? (
            <div className="w-full max-w-md bg-slate-800 border border-slate-600 rounded-xl p-6 space-y-3 my-8">
              <h2 className="text-lg font-bold text-slate-100">Deal created</h2>
              <p className="text-sm text-slate-400">The deal is ready, with a couple of things to follow up on:</p>
              <ul className="list-disc pl-5 text-sm text-amber-300 space-y-1">
                {dealCreated.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <Link href={`/dashboard/transactions/${dealCreated.txId}`} className="inline-block px-5 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg">
                Open the deal
              </Link>
            </div>
          ) : (
          <form onSubmit={convert} className="w-full max-w-md bg-slate-800 border border-slate-600 rounded-xl p-6 space-y-3 my-8">
            <h2 className="text-lg font-bold text-slate-100">Convert to a deal</h2>
            <p className="text-sm text-slate-400">
              Creates a new transaction for {listing.property_address} with the agent and everyone listed here, and starts your closing checklist from the dates below.
              {convertOffer !== 'none' ? ' The offer is marked accepted.' : ''}
            </p>

            {/* Fill the deal in from a contract */}
            <div className="rounded-lg border border-slate-700 bg-slate-900/30 p-3 space-y-2">
              <p className="text-sm font-medium text-slate-200">Fill in from a contract</p>
              <p className="text-xs text-slate-500">Read the signed purchase contract to fill in the price, dates, contract deadlines and the people named. You review everything before the deal is created.</p>
              {reading && <p className="text-xs text-blue-300">{reading === 'uploading' ? 'Uploading…' : 'Reading the contract…'}</p>}
              {readError && <p className="text-xs text-amber-300">{readError}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className={`${inputCls} !w-auto max-w-full`}
                  value=""
                  disabled={Boolean(reading)}
                  onChange={(e) => {
                    const [src, docId] = e.target.value.split(':');
                    if (docId) void readContract(src === 'offer' ? 'offer' : 'listing', docId);
                  }}
                  aria-label="Choose a contract to read"
                >
                  <option value="">Choose a file on this listing…</option>
                  {offerDocs.map((d) => (
                    <option key={`o${d.id}`} value={`offer:${d.id}`}>
                      Offer: {d.file_name}
                    </option>
                  ))}
                  {docs
                    .filter((d) => d.file_name.toLowerCase().endsWith('.pdf'))
                    .map((d) => (
                      <option key={`l${d.id}`} value={`listing:${d.id}`}>
                        {d.document_type}: {d.file_name}
                      </option>
                    ))}
                </select>
                <label className={`px-3 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-xs rounded-lg cursor-pointer ${reading ? 'opacity-50 pointer-events-none' : ''}`}>
                  Upload a contract
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      void uploadContractAndRead(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {dealRead && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs text-green-300">Filled in from {dealRead.fileName}. Check the details below.</p>
                  {dealRead.propertyAddress && !sameStreetNumber(dealRead.propertyAddress, listing.property_address) && (
                    <p className="text-xs text-amber-300">The contract says the property is at {dealRead.propertyAddress}, which does not look like {listing.property_address}. Make sure this is the right contract.</p>
                  )}
                  {dealRead.notes && <p className="text-xs text-amber-300">Double-check: {dealRead.notes}</p>}
                  {dealRead.dates.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-slate-400">Contract deadlines (added as the deal&apos;s critical dates):</p>
                      {dealRead.dates.map((d, i) => (
                        <div key={d.kind} className="flex items-center gap-2">
                          <span className="text-xs text-slate-300 flex-1 min-w-0 truncate">{d.label}</span>
                          <input
                            type="date"
                            className={`${inputCls} !w-auto`}
                            value={d.dueDate}
                            onChange={(e) => setDealRead({ ...dealRead, dates: dealRead.dates.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)) })}
                            aria-label={d.label}
                          />
                          <button type="button" onClick={() => setDealRead({ ...dealRead, dates: dealRead.dates.filter((_, j) => j !== i) })} className="text-slate-500 hover:text-red-300 text-sm" aria-label={`Remove ${d.label}`}>
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {dealRead.contacts.length > 0 && (
                    <p className="text-xs text-slate-400">
                      People added to the deal: {dealRead.contacts.map((c) => `${c.role}: ${c.name}`).join(' · ')}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className={labelCls}>File number</label>
              <input className={inputCls} value={conv.fileNumber} onChange={(e) => setConv({ ...conv, fileNumber: e.target.value })} required />
              <p className="text-[11px] text-slate-500 mt-1">Starts as today&apos;s date. Change it to anything you like.</p>
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
              <MoneyInput className={inputCls} aria-label="Sale price" value={conv.price} onValueChange={(v) => setConv({ ...conv, price: v })} />
            </div>
            {(() => {
              const agentRow = agents.find((a) => a.id === listing.agent_id);
              return (
                <label className={`flex items-start gap-2 text-sm ${agentRow?.email ? 'text-slate-300 cursor-pointer' : 'text-slate-500'}`}>
                  <input
                    type="checkbox"
                    checked={inviteAgent && Boolean(agentRow?.email)}
                    disabled={!agentRow?.email}
                    onChange={(e) => setInviteAgent(e.target.checked)}
                    className="mt-0.5 accent-blue-500"
                  />
                  <span>
                    {agentRow?.email ? `Put this deal on ${agentRow.name}'s agent portal and email them (${agentRow.email})` : 'The agent has no email on file, so no agent portal invite can be sent. Add one on the Agents page.'}
                  </span>
                </label>
              );
            })()}
            {convertError && <p className="text-sm text-red-400">{convertError}</p>}
            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={converting || Boolean(reading) || !conv.fileNumber.trim()} className="px-5 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                {converting ? 'Creating the deal…' : 'Create deal'}
              </button>
              <button type="button" onClick={() => setConvertOffer(null)} disabled={converting} className="text-sm text-slate-400 hover:text-slate-200">
                Cancel
              </button>
            </div>
          </form>
          )}
        </div>
      )}
    </div>
  );
}
