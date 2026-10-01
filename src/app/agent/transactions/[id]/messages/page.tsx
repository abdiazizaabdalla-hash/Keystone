'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { DEFAULT_CATEGORY_KEY, DEFAULT_DOCUMENT_TYPE } from '@/lib/documentTaxonomy';

interface TransactionSummary {
  id: string;
  fileNumber: string;
  propertyAddress: string | null;
  agentName: string;
  tcLabel: string;
}

interface MessageRow {
  id: string;
  sender_id: string;
  sender_role: 'tc' | 'agent';
  body: string;
  created_at: string;
  attachment?: { id: string; fileName: string; url: string | null; contentType: string | null; fileSize: number | null } | null;
}

// How often the thread re-fetches while this page is open -- same interval
// and "paused while hidden" shape as the TC-side mirror, see
// MESSAGE_POLL_MS in dashboard/transactions/[id]/messages/page.tsx.
const MESSAGE_POLL_MS = 5000;

// Agent-side mirror of the TC's full-page Messages portal (same layout,
// same send/attach flow) -- just pointed at the agent's own data route
// (/api/agent/transactions/[id], which already gates on
// assertAgentOnTransaction) instead of the TC's /api/transactions list.
// The transaction page itself now just shows a preview of the latest
// message and a link in here. See the TC-side version at
// src/app/dashboard/transactions/[id]/messages/page.tsx.
export default function AgentTransactionMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [transaction, setTransaction] = useState<TransactionSummary | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [txRes, messagesRes] = await Promise.all([
          authFetch(`/api/agent/transactions/${id}`),
          authFetch(`/api/messages?transactionId=${id}`),
        ]);
        if (!txRes.ok) throw new Error('Failed to load this transaction');
        setTransaction(await txRes.json());
        setMessages(messagesRes.ok ? await messagesRes.json() : []);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          router.push('/agent/login');
          return;
        }
        console.error('Error loading messages:', err);
        setError('Could not load this conversation.');
      } finally {
        setLoading(false);
      }
    };
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

  const handleAttachFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !transaction) return;
    try {
      setIsAttachingFile(true);
      setAttachError('');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('transactionId', transaction.id);
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
          transactionId: transaction.id,
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

  const tcLabel = transaction?.tcLabel || 'your TC';
  const selfLabel = transaction?.agentName || 'You';

  const formatTime = (value: string) => {
    const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
    const date = new Date(hasOffset ? value : `${value}Z`);
    return date.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    });
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
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="text-red-400 mb-4">{error || 'Conversation not found.'}</p>
          <Link href="/agent" className="text-blue-400 hover:text-blue-300 text-sm font-medium">
            ← Back to your transactions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-700 bg-slate-900/60 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <Link
            href={`/agent/transactions/${transaction.id}`}
            className="text-blue-400 hover:text-blue-300 text-sm font-medium shrink-0"
          >
            ← Back
          </Link>
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
            {tcLabel[0]?.toUpperCase() || 'T'}
          </div>
          <div className="min-w-0">
            <h1 className="text-slate-100 font-display font-semibold truncate">{tcLabel}</h1>
            <p className="text-slate-500 text-xs truncate">{transaction.propertyAddress || transaction.fileNumber}</p>
          </div>
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {messages.length === 0 && (
            <p className="text-slate-500 text-sm text-center mt-10">No messages yet -- say hello.</p>
          )}
          {messages.map((m) => {
            const isSelf = m.sender_role === 'agent';
            const label = isSelf ? selfLabel : tcLabel;
            const initial = label[0]?.toUpperCase() || (isSelf ? 'A' : 'T');
            return (
              <div key={m.id} className={`flex items-end gap-3 ${isSelf ? 'justify-end' : 'justify-start'}`}>
                {!isSelf && (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
                    {initial}
                  </div>
                )}
                <div className={`flex flex-col max-w-[75%] ${isSelf ? 'items-end' : 'items-start'}`}>
                  <p className="text-xs font-semibold text-slate-400 mb-1 px-1">{label}</p>
                  <div
                    className={`rounded-2xl px-4 py-3 text-base whitespace-pre-wrap ${
                      isSelf ? 'bg-emerald-600 text-white' : 'bg-slate-700/80 text-slate-100'
                    }`}
                  >
                    {m.body && <p>{m.body}</p>}
                    {m.attachment && (
                      <a
                        href={m.attachment.url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center gap-1.5 text-sm underline underline-offset-2 ${
                          isSelf ? 'text-emerald-100' : 'text-blue-300'
                        } ${m.body ? 'mt-2' : ''}`}
                      >
                        📎 {m.attachment.fileName}
                      </a>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1 px-1">{formatTime(m.created_at)}</p>
                </div>
                {isSelf && (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
                    {initial}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-slate-700 bg-slate-900/60 px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <input
            ref={messageFileInputRef}
            type="file"
            accept="application/pdf,image/*,.doc,.docx"
            className="hidden"
            onChange={handleAttachFileSelected}
          />
          {attachError && <p className="text-xs text-red-400 mb-2">{attachError}</p>}
          {pendingAttachment && (
            <div className="flex items-center gap-2 mb-2 text-sm text-slate-300 bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2">
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
              className="px-4 py-3 bg-slate-600 hover:bg-slate-500 border border-slate-600 text-slate-200 rounded-lg transition disabled:opacity-50 flex-shrink-0"
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
              placeholder={`Message ${tcLabel}…`}
              className="flex-1 bg-slate-600 border border-slate-600 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 text-base focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={handleSendMessage}
              disabled={sendingMessage || (!messageDraft.trim() && !pendingAttachment)}
              className="px-5 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
