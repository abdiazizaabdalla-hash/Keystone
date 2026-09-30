'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { DOCUMENT_CATEGORIES, DEFAULT_CATEGORY_KEY, DEFAULT_DOCUMENT_TYPE, categoryLabel } from '@/lib/documentTaxonomy';

interface AgentTransactionDetail {
  id: string;
  fileNumber: string;
  propertyAddress: string | null;
  status: string;
  tcLabel: string;
  tasks: { id: string; name: string; completed: boolean; sort_order: number }[];
}

interface DocumentRow {
  id: string;
  file_name: string;
  category: string;
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

// Read-only status/checklist, view+download+upload documents, and a
// message thread with the TC -- everything an invited agent can do (see
// the design notes in lib/agentPortal.ts for what they deliberately
// can't: other transactions, other agents, invoices/commission,
// account/billing).
export default function AgentTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [transaction, setTransaction] = useState<AgentTransactionDetail | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [uploadCategory, setUploadCategory] = useState(DEFAULT_CATEGORY_KEY);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

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

  const handleUpload = async (file: File) => {
    try {
      setUploading(true);
      setUploadError('');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('transactionId', id);
      formData.append('category', uploadCategory);
      formData.append('documentType', DEFAULT_DOCUMENT_TYPE);
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
      setUploading(false);
    }
  };

  const handleSendMessage = async () => {
    const text = messageDraft.trim();
    if (!text) return;
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-12">
      <div className="max-w-4xl mx-auto">
        <Link href="/agent" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-6 text-sm font-medium">
          ← Your deals
        </Link>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-8">
            <section className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
              <h2 className="text-lg font-bold text-slate-100 mb-4">Checklist</h2>
              <ul className="space-y-2">
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

            <section className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
              <h2 className="text-lg font-bold text-slate-100 mb-4">Documents</h2>

              <div className="space-y-2 mb-4">
                {documents.length === 0 && <p className="text-slate-500 text-sm">No documents yet.</p>}
                {documents.map((doc) => (
                  <a
                    key={doc.id}
                    href={doc.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 bg-slate-800/50 border border-slate-600 rounded-lg px-3 py-2 text-sm hover:border-blue-500 transition"
                  >
                    <span className="text-slate-200 truncate">{doc.file_name}</span>
                    <span className="text-slate-500 text-xs shrink-0">{categoryLabel(doc.category)}</span>
                  </a>
                ))}
              </div>

              <div className="border-t border-slate-600 pt-4">
                <label className="text-sm text-slate-400 block mb-2">Upload a document</label>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    className="bg-slate-600 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    {DOCUMENT_CATEGORIES.map((cat) => (
                      <option key={cat.key} value={cat.key}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="file"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUpload(file);
                      e.target.value = '';
                    }}
                    className="text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:text-sm file:font-semibold hover:file:bg-blue-500 disabled:opacity-50"
                  />
                </div>
                {uploading && <p className="text-slate-500 text-xs mt-2">Uploading…</p>}
                {uploadError && <p className="text-red-400 text-xs mt-2">{uploadError}</p>}
              </div>
            </section>
          </div>

          <section className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6 flex flex-col h-[32rem]">
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
        </div>
      </div>
    </div>
  );
}
