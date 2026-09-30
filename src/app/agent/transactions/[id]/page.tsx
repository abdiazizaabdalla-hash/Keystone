'use client';

import { use, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
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
  agentName: string;
  tcLabel: string;
  tasks: { id: string; name: string; completed: boolean; sort_order: number }[];
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
}

// Read-only status/checklist, the same category-organized document
// browser the TC uses (view/download/upload -- no delete or
// signature-workflow controls, those stay TC-only), and a message thread
// with the TC. See the design notes in lib/agentPortal.ts for what an
// agent deliberately can't see: other transactions, other agents,
// invoices/commission, account/billing.
export default function AgentTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [transaction, setTransaction] = useState<AgentTransactionDetail | null>(null);
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

  const loadAll = async () => {
    try {
      const [txRes, docsRes, messagesRes] = await Promise.all([
        authFetch(`/api/agent/transactions/${id}`),
        authFetch(`/api/documents?transactionId=${id}`),
        authFetch(`/api/messages?transactionId=${id}`),
      ]);
      if (!txRes.ok) throw new Error('Failed to load this transaction');
      setTransaction(await txRes.json());
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

  const handleSendMessage = async () => {
    const text = messageDraft.trim();
    if (!text || !transaction) return;
    try {
      setSendingMessage(true);
      const res = await authFetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: id, body: text }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to send message');
      setMessages((prev) => [...prev, result]);
      setMessageDraft('');
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
      <div className="max-w-5xl mx-auto">
        <Link href="/agent" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-6 text-sm font-medium">
          ← Your deals
        </Link>

        {/* Same core deal info the TC's own page shows -- agent, price,
            status, dates -- just plain text instead of editable
            dropdowns/inputs. Nothing about invoices or commission here,
            that stays TC-only (see lib/agentPortal.ts). */}
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h1 className="text-xl font-display font-semibold text-slate-100">
                {transaction.propertyAddress || transaction.fileNumber}
              </h1>
              <p className="text-slate-500 text-sm mt-0.5">Coordinated by {transaction.tcLabel}</p>
            </div>
            <span className="text-xs font-semibold text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-full px-3 py-1">
              {transaction.status}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-6 pt-6 border-t border-slate-600">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Agent</p>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {transaction.agentName[0]}
                </div>
                <p className="text-base font-semibold text-slate-100">{transaction.agentName}</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Purchase Price</p>
              <p className="text-xl font-bold text-blue-400">
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

        <section className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6 mb-8 flex flex-col h-[28rem]">
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
                  {m.body}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
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
              disabled={sendingMessage || !messageDraft.trim()}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </section>
        <section className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-bold text-slate-100 mb-4">Checklist</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {transaction.tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 text-sm">
                <span
                  className={`w-4 h-4 rounded-full shrink-0 border ${
                    task.completed ? 'bg-green-500 border-green-500' : 'border-slate-500'
                  }`}
                />
                <span className={task.completed ? 'text-slate-400 line-through' : 'text-slate-200'}>{task.name}</span>
              </li>
            ))}
          </ul>
          <p className="text-slate-500 text-xs mt-4">View-only -- your TC updates this checklist.</p>
        </section>

        <section className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-bold text-slate-100 mb-1">Documents</h2>
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
  );
}
