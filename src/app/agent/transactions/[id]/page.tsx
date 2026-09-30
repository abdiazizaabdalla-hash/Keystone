'use client';

import { use, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
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

// How often the message thread re-fetches while this page is open. This
// codebase doesn't use Supabase Realtime anywhere, so a plain interval
// (paused while the tab isn't visible) is the lowest-risk way to get a
// conversation updating without a manual reload -- see the matching
// effect on the TC side, dashboard/transactions/[id]/page.tsx.
const MESSAGE_POLL_MS = 5000;

// A near-exact mirror of the TC's own transaction page (info card,
// Messages + Checklist + Contacts in the narrow column, the same
// categorized Documents browser in the wide column) -- just read-only
// throughout, and with nothing about invoices or commission. See the
// design notes in lib/agentPortal.ts for what an agent deliberately
// can't see: other transactions, other agents, invoices/commission,
// account/billing.
export default function AgentTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [transaction, setTransaction] = useState<AgentTransactionDetail | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [docSearch, setDocSearch] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');
  const categoryFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadCategory = useRef<string | null>(null);

  const [messageDraft, setMessageDraft] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<{ id: string; fileName: string } | null>(null);
  const [isAttachingFile, setIsAttachingFile] = useState(false);
  const [attachError, setAttachError] = useState('');
  const messageFileInputRef = useRef<HTMLInputElement | null>(null);

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
      const [txRes, contactsRes, docsRes, messagesRes] = await Promise.all([
        authFetch(`/api/agent/transactions/${id}`),
        authFetch(`/api/transactions/${id}/contacts`),
        authFetch(`/api/documents?transactionId=${id}`),
        authFetch(`/api/messages?transactionId=${id}`),
      ]);
      if (!txRes.ok) throw new Error('Failed to load this transaction');
      setTransaction(await txRes.json());
      setContacts(contactsRes.ok ? await contactsRes.json() : []);
      setDocuments(docsRes.ok ? await docsRes.json() : []);
      setMessages(messagesRes.ok ? await messagesRes.json() : []);
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

  const handleAttachFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setIsAttachingFile(true);
      setAttachError('');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('transactionId', id);
      formData.append('category', DEFAULT_CATEGORY_KEY);
      formData.append('documentType', DEFAULT_DOCUMENT_TYPE);
      formData.append('requiresSignature', 'false');
      const res = await authFetch('/api/documents', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to attach file');
      setPendingAttachment({ id: result.id, fileName: result.file_name });
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/agent/login');
        return;
      }
      setAttachError(err instanceof Error ? err.message : 'Failed to attach file');
    } finally {
      setIsAttachingFile(false);
    }
  };

  const handleSendMessage = async () => {
    const text = messageDraft.trim();
    if ((!text && !pendingAttachment) || !transaction) return;
    try {
      setSendingMessage(true);
      const res = await authFetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: id,
          body: text,
          ...(pendingAttachment ? { attachmentDocumentId: pendingAttachment.id } : {}),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to send message');
      setMessages((prev) => [...prev, result]);
      setMessageDraft('');
      setPendingAttachment(null);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/agent/login');
        return;
      }
      console.error('Error sending message:', err);
    } finally {
      setSendingMessage(false);
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
        <Link href="/agent" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-6 text-sm font-medium">
          ← Your deals
        </Link>

        {/* Same core deal info the TC's own page shows -- agent, price,
            status, dates -- just plain text instead of editable
            dropdowns/inputs. Nothing about invoices or commission here,
            that stays TC-only (see lib/agentPortal.ts). */}
        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h1 className="text-xl font-display font-semibold text-slate-100">
                {transaction.propertyAddress || transaction.fileNumber}
              </h1>
              <p className="text-slate-500 text-sm mt-0.5">Coordinated by {transaction.tcLabel}</p>
            </div>
            <span className="inline-block px-3 py-1 bg-blue-500/20 border border-blue-500/50 text-blue-300 text-sm font-semibold rounded-full">
              {transaction.status}
            </span>
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
              <p className="text-slate-100">{transaction.acceptanceDate || '—'}</p>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Target Closing Date</p>
              <p className="text-slate-100">{transaction.closingDate || '—'}</p>
            </div>
          </div>
        </div>

        {/* Same grid the TC page uses: Documents wide on the left,
            Messages + Checklist + Contacts stacked in a narrow column on
            the right. Both stack full-width on mobile, in source order. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
          <div className="lg:order-2 lg:self-start flex flex-col gap-8">
            <section className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6 flex flex-col h-[28rem]">
              <h2 className="text-lg font-bold text-slate-100 mb-4">Messages</h2>
              <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1">
                {messages.length === 0 && <p className="text-slate-500 text-sm">No messages yet -- say hello.</p>}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender_role === 'agent' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                        m.sender_role === 'agent' ? 'bg-blue-600 text-white' : 'bg-slate-800/70 text-slate-200'
                      }`}
                    >
                      {m.body && <p>{m.body}</p>}
                      {m.attachment && (
                        <a
                          href={m.attachment.url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-1.5 text-xs underline underline-offset-2 ${
                            m.sender_role === 'agent' ? 'text-blue-100' : 'text-blue-300'
                          } ${m.body ? 'mt-1.5' : ''}`}
                        >
                          📎 {m.attachment.fileName}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <input
                ref={messageFileInputRef}
                type="file"
                accept="application/pdf,image/*,.doc,.docx"
                className="hidden"
                onChange={handleAttachFileSelected}
              />
              {attachError && <p className="text-xs text-red-400 mb-2">{attachError}</p>}
              {pendingAttachment && (
                <div className="flex items-center gap-2 mb-2 text-xs text-slate-300 bg-slate-700/50 border border-slate-600 rounded-lg px-2.5 py-1.5">
                  <span className="truncate flex-1">📎 {pendingAttachment.fileName}</span>
                  <button
                    type="button"
                    onClick={() => setPendingAttachment(null)}
                    className="text-slate-500 hover:text-red-400 transition flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => messageFileInputRef.current?.click()}
                  disabled={isAttachingFile}
                  title="Attach a file"
                  className="px-3 py-2 bg-slate-600 hover:bg-slate-500 border border-slate-600 text-slate-200 rounded-lg transition disabled:opacity-50 flex-shrink-0"
                >
                  {isAttachingFile ? '…' : '📎'}
                </button>
                <input
                  type="text"
                  value={messageDraft}
                  onChange={(e) => setMessageDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder={`Message ${transaction.tcLabel}…`}
                  className="flex-1 bg-slate-600 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={sendingMessage || (!messageDraft.trim() && !pendingAttachment)}
                  className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
                >
                  Send
                </button>
              </div>
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
                            {formatDisplayDate(task.due_date, { month: 'short', day: 'numeric' })}
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
              </div>
              <p className="text-slate-500 text-xs mt-4">View-only -- your TC manages contacts.</p>
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
                              {!doc.requires_signature ? (
                                <span className="text-xs px-2 py-0.5 bg-slate-700/60 border border-slate-600 rounded-full text-slate-400 flex-shrink-0">
                                  No signature needed
                                </span>
                              ) : doc.is_signed ? (
                                <span className="text-xs px-2 py-0.5 bg-green-900/30 border border-green-700/50 rounded-full text-green-300 flex-shrink-0">
                                  ✓ Signed
                                </span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 bg-slate-700 border border-slate-600 rounded-full text-slate-400 flex-shrink-0">
                                  Unsigned
                                </span>
                              )}
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
