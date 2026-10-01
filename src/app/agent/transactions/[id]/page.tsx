'use client';

import { use, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch, AuthRequiredError, clearSession } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';
import {
  DOCUMENT_CATEGORIES,
  DEFAULT_CATEGORY_KEY,
  DEFAULT_DOCUMENT_TYPE,
  typesForCategory,
} from '@/lib/documentTaxonomy';

interface AgentTransactionDetail {
  id: string;
  fileNumber: string;
  propertyAddress: string | null;
  status: string;
  purchasePrice: number | null;
  acceptanceDate: string | null;
  closingDate: string | null;
  checklistTemplateName: string | null;
  agentName: string;
  agentEmail: string | null;
  agentPhone: string | null;
  tcLabel: string;
  tasks: { id: string; name: string; completed: boolean; sort_order: number; due_date: string | null }[];
}

interface Contact {
  id: string;
  role: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface DocumentRow {
  id: string;
  file_name: string;
  document_type: string | null;
  category: string | null;
  task_id: string | null;
  file_size: number | null;
  requires_signature: boolean;
  is_signed: boolean;
  url: string | null;
  created_at: string;
}

interface MessageRow {
  id: string;
  sender_id: string;
  sender_role: 'tc' | 'agent';
  body: string;
  created_at: string;
  attachment_document_id?: string | null;
  attachment?: { id: string; fileName: string; url: string | null; contentType: string | null; fileSize: number | null } | null;
}

interface AgentInvoice {
  id: string;
  invoice_number: string;
  amount_owed: number;
  due_date: string;
  invoice_date: string;
  paid: boolean;
  paid_at: string | null;
  paid_amount: number | null;
  refunded: boolean;
  refunded_at: string | null;
}

// How often the message thread re-fetches while this page is open. This
// codebase doesn't use Supabase Realtime anywhere, so a plain interval
// (paused while the tab isn't visible) is the lowest-risk way to get a
// conversation updating without a manual reload -- see the matching
// effect on the TC side, dashboard/transactions/[id]/page.tsx.
const MESSAGE_POLL_MS = 5000;

// A near-exact mirror of the TC's own transaction page (info card,
// Messages + Checklist + Contacts in the narrow column, the same
// categorized Documents browser in the wide column) -- just read-only
// throughout, with one exception: the agent's own invoice (amount,
// due date, paid/unpaid, and a Stripe pay link -- see the Invoice
// section below) is visible and payable here, same as the TC's own
// invoice page. Still nothing about commission math, other agents,
// other transactions, or account/billing -- see lib/agentPortal.ts.
export default function AgentTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  // Same clearSession-then-redirect shape as the agent hub's logout
  // (src/app/agent/page.tsx) -- available here too since an agent can be
  // deep in a transaction without having gone through the hub first.
  const handleLogout = () => {
    clearSession();
    router.push('/agent/login');
  };

  const [transaction, setTransaction] = useState<AgentTransactionDetail | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [invoice, setInvoice] = useState<AgentInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isGeneratingPayLink, setIsGeneratingPayLink] = useState(false);
  const [stripePayUrl, setStripePayUrl] = useState<string | null>(null);
  const [payLinkError, setPayLinkError] = useState('');

  const [docSearch, setDocSearch] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');
  const categoryFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadCategory = useRef<string | null>(null);


  const [isAddingContact, setIsAddingContact] = useState(false);
  const [newContactRole, setNewContactRole] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [savingContact, setSavingContact] = useState(false);
  const [addContactError, setAddContactError] = useState('');

  const fetchMessages = async () => {
    try {
      const res = await authFetch(`/api/messages?transactionId=${id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setMessages(data);
    } catch {
      // Silent -- this also runs on an unattended timer, see below.
    }
  };

  const loadAll = async () => {
    try {
      const [txRes, contactsRes, docsRes, messagesRes, invoicesRes] = await Promise.all([
        authFetch(`/api/agent/transactions/${id}`),
        authFetch(`/api/transactions/${id}/contacts`),
        authFetch(`/api/documents?transactionId=${id}`),
        authFetch(`/api/messages?transactionId=${id}`),
        authFetch(`/api/agent/invoices?transactionId=${id}`),
      ]);
      if (!txRes.ok) throw new Error('Failed to load this transaction');
      setTransaction(await txRes.json());
      setContacts(contactsRes.ok ? await contactsRes.json() : []);
      setDocuments(docsRes.ok ? await docsRes.json() : []);
      setMessages(messagesRes.ok ? await messagesRes.json() : []);
      if (invoicesRes.ok) {
        const invoicesData = await invoicesRes.json();
        setInvoice(Array.isArray(invoicesData) && invoicesData.length > 0 ? invoicesData[0] : null);
      }
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/agent/login');
        return;
      }
      console.error('Error loading agent transaction:', err);
      setError('Could not load this transaction. You may not have access to it.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchMessages();
    }, MESSAGE_POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const triggerCategoryUpload = (categoryKey: string) => {
    pendingUploadCategory.current = categoryKey;
    if (categoryFileInputRef.current) categoryFileInputRef.current.value = '';
    categoryFileInputRef.current?.click();
  };

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const category = pendingUploadCategory.current;
    pendingUploadCategory.current = null;
    if (!file || !category) return;

    try {
      setUploadingCategory(category);
      setUploadError('');
      const documentType = typesForCategory(category)[0] || DEFAULT_DOCUMENT_TYPE;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('transactionId', id);
      formData.append('category', category);
      formData.append('documentType', documentType);
      const res = await authFetch('/api/documents', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to upload document');
      setDocuments((prev) => [result, ...prev]);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/agent/login');
        return;
      }
      setUploadError(err instanceof Error ? err.message : 'Failed to upload document');
    } finally {
      setUploadingCategory(null);
    }
  };

  const toggleCategoryCollapsed = (categoryKey: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [categoryKey]: !prev[categoryKey] }));
  };

  // Agents can mark a document Signed/Not Signed and flip whether it needs
  // a signature at all -- same two PATCH-able flags the TC has. Actually
  // *sending* a signature request (and voiding one) stays TC-only, so
  // there's no Request Signature button here, just these two toggles.
  const [togglingSignedDocId, setTogglingSignedDocId] = useState<string | null>(null);
  const handleToggleSigned = async (docId: string, nextIsSigned: boolean) => {
    try {
      setTogglingSignedDocId(docId);
      const res = await authFetch('/api/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docId, isSigned: nextIsSigned }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update document');
      setDocuments((prev) => prev.map((d) => (d.id === docId ? { ...d, is_signed: nextIsSigned } : d)));
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/agent/login');
        return;
      }
      alert(err instanceof Error ? err.message : 'Failed to update document');
    } finally {
      setTogglingSignedDocId(null);
    }
  };

  const [togglingRequiresSignatureDocId, setTogglingRequiresSignatureDocId] = useState<string | null>(null);
  const handleToggleRequiresSignature = async (docId: string, nextRequiresSignature: boolean) => {
    try {
      setTogglingRequiresSignatureDocId(docId);
      const res = await authFetch('/api/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docId, requiresSignature: nextRequiresSignature }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to update document');
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, requires_signature: nextRequiresSignature } : d))
      );
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/agent/login');
        return;
      }
      alert(err instanceof Error ? err.message : 'Failed to update document');
    } finally {
      setTogglingRequiresSignatureDocId(null);
    }
  };

  // Same two-step shape as the TC's own invoice page (handleGeneratePayLink
  // there): a Checkout Session URL is only valid 24h, so it's kept in
  // local state and regenerated on demand rather than persisted. Whoever
  // completes the Checkout -- the webhook doesn't care that it was the
  // agent this time -- is what flips invoice.paid, via
  // POST /api/stripe/connect/webhook's metadata.relay_invoice_id lookup.
  const handleGeneratePayLink = async () => {
    if (!invoice) return;
    try {
      setIsGeneratingPayLink(true);
      setPayLinkError('');
      const res = await authFetch(`/api/invoices/${invoice.id}/stripe-pay-link`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create pay link');
      setStripePayUrl(data.payUrl);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/agent/login');
        return;
      }
      setPayLinkError(err instanceof Error ? err.message : 'Error creating pay link');
    } finally {
      setIsGeneratingPayLink(false);
    }
  };

  // Agents can add a contact the TC hasn't entered yet (a lender, title
  // company, etc.) but can't edit or remove any contact -- that stays
  // TC-only, see POST /api/transactions/[id]/contacts.
  const handleAddContact = async () => {
    if (!newContactRole.trim() && !newContactName.trim() && !newContactEmail.trim() && !newContactPhone.trim()) {
      setAddContactError('Enter at least one field.');
      return;
    }
    try {
      setSavingContact(true);
      setAddContactError('');
      const res = await authFetch(`/api/transactions/${id}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: newContactRole.trim(),
          name: newContactName.trim(),
          email: newContactEmail.trim(),
          phone: newContactPhone.trim(),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to add contact');
      setContacts((prev) => [...prev, result]);
      setNewContactRole('');
      setNewContactName('');
      setNewContactEmail('');
      setNewContactPhone('');
      setIsAddingContact(false);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/agent/login');
        return;
      }
      setAddContactError(err instanceof Error ? err.message : 'Failed to add contact');
    } finally {
      setSavingContact(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading…</p>
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8 text-center max-w-md">
          <p className="text-slate-300">{error || 'Transaction not found.'}</p>
          <Link href="/agent" className="text-blue-400 hover:text-blue-300 text-sm font-medium mt-4 inline-block">
            ← Back to your deals
          </Link>
        </div>
      </div>
    );
  }

  const taskNameById = transaction.tasks.reduce<Record<string, string>>((acc, t) => {
    acc[t.id] = t.name;
    return acc;
  }, {});

  const completedCount = transaction.tasks.filter((t) => t.completed).length;
  const completionPercent = transaction.tasks.length > 0 ? Math.round((completedCount / transaction.tasks.length) * 100) : 0;
  const todayIso = new Date().toISOString().split('T')[0];

  const searchLower = docSearch.trim().toLowerCase();
  const filteredDocuments = searchLower
    ? documents.filter((d) => {
        const stageName = d.task_id ? taskNameById[d.task_id] || '' : '';
        return (
          d.file_name.toLowerCase().includes(searchLower) ||
          (d.document_type || '').toLowerCase().includes(searchLower) ||
          (d.category || '').toLowerCase().includes(searchLower) ||
          stageName.toLowerCase().includes(searchLower)
        );
      })
    : documents;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-12">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-6">
          <Link href="/agent" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm font-medium">
            ← Your deals
          </Link>
          <button
            onClick={handleLogout}
            className="shrink-0 text-sm text-slate-400 hover:text-red-300 font-medium px-3 py-1.5 rounded-lg hover:bg-red-900/20 transition"
          >
            Log out
          </button>
        </div>

        {/* Same core deal info the TC's own page shows -- agent, price,
            status, dates -- just plain text instead of editable
            dropdowns/inputs. The Invoice section below is the one part
            of this card that isn't purely read-only. */}
        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8 mb-8">
          <div className="mb-4">
            <h1 className="text-xl font-display font-semibold text-slate-100">
              {transaction.propertyAddress || transaction.fileNumber}
            </h1>
            <p className="text-slate-500 text-sm mt-0.5">Coordinated by {transaction.tcLabel}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-6 pt-6 border-t border-slate-600">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Agent</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {transaction.agentName[0]}
                </div>
                <p className="text-lg font-semibold text-slate-100">{transaction.agentName}</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Purchase Price</p>
              <p className="text-2xl font-bold text-blue-400">
                {transaction.purchasePrice != null ? `$${transaction.purchasePrice.toLocaleString()}` : '—'}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Status</p>
              <p className="text-slate-100 font-medium">{transaction.status}</p>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Acceptance Date</p>
              <p className="text-slate-100">{transaction.acceptanceDate ? formatDisplayDate(transaction.acceptanceDate) : '—'}</p>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Target Closing Date</p>
              <p className="text-slate-100">{transaction.closingDate ? formatDisplayDate(transaction.closingDate) : '—'}</p>
            </div>
          </div>

          {/* Invoice: only shows once the TC has actually generated one
              (same "no invoice yet" silence as the TC's own page shows
              before that point -- an agent never sees fee math, just the
              finished invoice once it exists). Paid/unpaid as plain
              colored text, no pill, matching the rest of this page. */}
          {invoice && (
            <div className="pt-6 mt-6 border-t border-slate-600">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Invoice</p>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-slate-100 font-semibold">
                    {invoice.invoice_number} · ${invoice.amount_owed.toLocaleString()} ·{' '}
                    <span className={invoice.paid ? 'text-green-400' : 'text-blue-400'}>
                      {invoice.paid ? 'Paid' : 'Unpaid'}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {invoice.paid && invoice.paid_at
                      ? `Paid on ${formatDisplayDate(invoice.paid_at)}`
                      : `Due ${formatDisplayDate(invoice.due_date)}`}
                  </p>
                </div>
                {!invoice.paid &&
                  (stripePayUrl ? (
                    <a
                      href={stripePayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 border border-blue-500/50 text-blue-300 hover:text-blue-200 hover:border-blue-400 rounded-lg transition font-medium text-sm shrink-0"
                    >
                      Open Pay Online Link ↗
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={handleGeneratePayLink}
                      disabled={isGeneratingPayLink}
                      className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50 shrink-0"
                    >
                      {isGeneratingPayLink ? 'Creating link…' : 'Pay Now'}
                    </button>
                  ))}
              </div>
              {payLinkError && <p className="text-red-400 text-xs mt-2">{payLinkError}</p>}
            </div>
          )}
        </div>

        {/* Same grid the TC page uses: Documents wide on the left,
            Messages + Checklist + Contacts stacked in a narrow column on
            the right. Both stack full-width on mobile, in source order. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
          <div className="lg:order-2 lg:self-start flex flex-col gap-8">
            <section className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-100">Messages</h2>
                <Link
                  href={`/agent/transactions/${id}/messages`}
                  className="text-sm text-blue-400 hover:text-blue-300 font-medium transition"
                >
                  Open Messages →
                </Link>
              </div>
              {messages.length === 0 ? (
                <Link
                  href={`/agent/transactions/${id}/messages`}
                  className="block text-slate-500 text-sm hover:text-slate-400 transition"
                >
                  No messages yet -- say hello.
                </Link>
              ) : (
                (() => {
                  const last = messages[messages.length - 1];
                  return (
                    <Link
                      href={`/agent/transactions/${id}/messages`}
                      className="block hover:bg-slate-700/40 -mx-2 px-2 py-1.5 rounded-lg transition"
                    >
                      <p className="text-xs text-slate-500 mb-1">
                        {last.sender_role === 'agent' ? 'You' : transaction.tcLabel}
                      </p>
                      <p className="text-sm text-slate-300 truncate">
                        {last.body || (last.attachment ? `📎 ${last.attachment.fileName}` : '')}
                      </p>
                    </Link>
                  );
                })()
              )}
            </section>

            <section className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6">
              <div className="mb-5">
                <h2 className="text-lg font-bold text-slate-100 mb-1">Checklist</h2>
                <p className="text-xs text-slate-500 mb-4">{transaction.checklistTemplateName || 'Baseline (default)'}</p>

                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-xs font-medium text-slate-400">Progress</span>
                      <span className="text-xs font-semibold text-blue-400">{completionPercent}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-600 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300"
                        style={{ width: `${completionPercent}%` }}
                      />
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-400 mt-2">
                  <span className="font-semibold text-slate-300">{completedCount}</span> of{' '}
                  <span className="font-semibold text-slate-300">{transaction.tasks.length}</span> completed
                </p>
              </div>

              <div className="space-y-2">
                {transaction.tasks.map((task) => (
                  <div key={task.id} className="px-3 py-2 bg-slate-700/30 border border-slate-600 rounded-lg">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={task.completed}
                        disabled
                        className="w-4 h-4 rounded border-2 border-slate-600 accent-blue-500 cursor-not-allowed flex-shrink-0"
                      />
                      <span
                        className={`flex-1 text-sm font-medium ${task.completed ? 'line-through text-slate-500' : 'text-slate-200'}`}
                      >
                        {task.name}
                      </span>
                      {!task.completed &&
                        (task.due_date ? (
                          <span
                            className={`text-xs font-medium flex-shrink-0 ${
                              task.due_date < todayIso ? 'text-red-400' : 'text-slate-500'
                            }`}
                          >
                            {task.due_date < todayIso ? 'Overdue ' : 'Due '}
                            {formatDisplayDate(task.due_date, { month: '2-digit', day: '2-digit' })}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600 flex-shrink-0">No due date</span>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-slate-500 text-xs mt-4">View-only -- your TC updates this checklist.</p>
            </section>

            <section className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6">
              <h2 className="text-lg font-bold text-slate-100 mb-4">Contacts</h2>
              <div className="space-y-4">
                <div className="px-3 py-2 bg-slate-700/30 border border-slate-600 rounded-lg">
                  <span className="text-xs font-semibold text-blue-400">Agent</span>
                  <p className="text-sm font-medium text-slate-200 mt-1">{transaction.agentName || 'Unknown'}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{transaction.agentEmail || 'No email on file'}</p>
                  <p className="text-xs text-slate-400">{transaction.agentPhone || 'No phone on file'}</p>
                </div>

                {contacts.map((contact) => (
                  <div key={contact.id} className="px-3 py-2 bg-slate-700/30 border border-slate-600 rounded-lg">
                    <span className="text-xs font-semibold text-blue-400">{contact.role || 'Contact'}</span>
                    <p className="text-sm font-medium text-slate-200 mt-1">{contact.name || 'Unnamed'}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{contact.email || 'No email on file'}</p>
                    <p className="text-xs text-slate-400">{contact.phone || 'No phone on file'}</p>
                  </div>
                ))}

                {isAddingContact && (
                  <div className="px-3 py-2 bg-slate-700/20 border border-dashed border-slate-600 rounded-lg space-y-1.5">
                    <input
                      type="text"
                      value={newContactRole}
                      onChange={(e) => setNewContactRole(e.target.value)}
                      placeholder="Role (e.g. Lender)"
                      className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs font-semibold text-blue-300 placeholder:text-slate-500 placeholder:font-normal focus:border-blue-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      placeholder="Name or company"
                      className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                    <input
                      type="email"
                      value={newContactEmail}
                      onChange={(e) => setNewContactEmail(e.target.value)}
                      placeholder="Email"
                      className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                    <input
                      type="tel"
                      inputMode="tel"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                      placeholder="Phone"
                      className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                    {addContactError && <p className="text-[11px] text-red-400">{addContactError}</p>}
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleAddContact}
                        disabled={savingContact}
                        className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition disabled:opacity-50"
                      >
                        {savingContact ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingContact(false);
                          setAddContactError('');
                        }}
                        disabled={savingContact}
                        className="text-xs text-slate-500 hover:text-slate-300 transition disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {!isAddingContact && (
                <button
                  type="button"
                  onClick={() => setIsAddingContact(true)}
                  className="mt-3 text-xs text-blue-400 hover:text-blue-300 font-medium transition"
                >
                  + Add contact
                </button>
              )}

              <p className="text-slate-500 text-xs mt-4">
                You can add a contact -- editing or removing one stays with your TC.
              </p>
            </section>
          </div>

          <section className="lg:order-1 bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8">
            <h2 className="text-2xl font-bold text-slate-100 mb-2">Documents</h2>
            <p className="text-sm text-slate-400 mb-6">
              Organized by category, same as your TC sees it. Upload straight into a category, or view/download
              anything already there -- editing or deleting a document stays with your TC.
            </p>

            <input
              ref={categoryFileInputRef}
              type="file"
              accept="application/pdf,image/*,.doc,.docx"
              className="hidden"
              onChange={handleFileSelected}
            />

            {uploadError && <p className="text-sm text-red-400 mb-4">{uploadError}</p>}

            <div className="mb-6">
              <input
                type="text"
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
                placeholder="Search documents by name, type, category, or checklist stage..."
                className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="space-y-3">
              {DOCUMENT_CATEGORIES.map((cat) => {
                const catDocs = filteredDocuments.filter((d) => (d.category || DEFAULT_CATEGORY_KEY) === cat.key);
                if (docSearch && catDocs.length === 0) return null;
                const isCollapsed = collapsedCategories[cat.key];

                return (
                  <div key={cat.key} className="bg-slate-700/30 border border-slate-600 rounded-lg overflow-hidden">
                    <div className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-700/50 transition">
                      <button
                        onClick={() => toggleCategoryCollapsed(cat.key)}
                        className="flex-1 flex items-center justify-between text-left min-w-0"
                      >
                        <span className="font-semibold text-slate-200">{cat.label}</span>
                        <span className="flex items-center gap-2 text-xs text-slate-400 ml-3">
                          {catDocs.length} document{catDocs.length === 1 ? '' : 's'}
                          <svg
                            className={`w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </span>
                      </button>
                      <button
                        onClick={() => triggerCategoryUpload(cat.key)}
                        disabled={uploadingCategory !== null}
                        className="flex-shrink-0 text-xs px-2.5 py-1 border border-slate-600 hover:border-blue-500 text-slate-300 hover:text-blue-300 rounded-lg transition disabled:opacity-50"
                      >
                        {uploadingCategory === cat.key ? 'Uploading…' : '+ Upload'}
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="px-4 pb-4 space-y-2">
                        {catDocs.length === 0 ? (
                          <p className="text-sm text-slate-500 italic">No documents in this category yet.</p>
                        ) : (
                          catDocs.map((doc) => (
                            <div
                              key={doc.id}
                              className="flex items-center justify-between gap-3 bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-2.5"
                            >
                              <div className="min-w-0 flex-1">
                                <a
                                  href={doc.url || '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-300 truncate block"
                                >
                                  📄 {doc.file_name}
                                </a>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                                  <span className="text-xs text-slate-500">{doc.document_type || 'General'}</span>
                                  {doc.task_id && taskNameById[doc.task_id] && (
                                    <span className="text-xs px-2 py-0.5 bg-slate-600 border border-slate-600 rounded-full text-slate-300">
                                      {taskNameById[doc.task_id]}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="text-xs text-slate-500 flex-shrink-0">
                                {doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} KB` : ''}
                              </span>
                              {doc.requires_signature && (
                                <label
                                  className={`flex items-center gap-1.5 text-xs flex-shrink-0 select-none ${
                                    togglingSignedDocId === doc.id ? 'opacity-50' : 'cursor-pointer'
                                  } ${doc.is_signed ? 'text-green-300 font-medium' : 'text-slate-400'}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={doc.is_signed}
                                    disabled={togglingSignedDocId === doc.id}
                                    onChange={(e) => handleToggleSigned(doc.id, e.target.checked)}
                                    className="w-3.5 h-3.5 rounded border-slate-500 bg-slate-700 text-green-500 focus:ring-0 focus:ring-offset-0 cursor-pointer disabled:cursor-not-allowed"
                                  />
                                  Signed
                                </label>
                              )}
                              <button
                                onClick={() => handleToggleRequiresSignature(doc.id, !doc.requires_signature)}
                                disabled={togglingRequiresSignatureDocId === doc.id}
                                className="text-xs px-2 py-1 border border-slate-600 hover:border-slate-400 text-slate-500 hover:text-slate-300 rounded-lg transition flex-shrink-0 disabled:opacity-50"
                                title={doc.requires_signature ? 'Mark as not requiring a signature' : 'Mark as requiring a signature'}
                              >
                                {togglingRequiresSignatureDocId === doc.id
                                  ? '...'
                                  : doc.requires_signature
                                    ? 'No sig needed'
                                    : 'Needs sig'}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {docSearch && filteredDocuments.length === 0 && (
                <p className="text-sm text-slate-500 italic">No documents match &quot;{docSearch}&quot;.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
