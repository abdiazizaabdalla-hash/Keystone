'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { uploadIncoming } from '@/lib/incomingUploadClient';

export interface ListingThreadComment {
  id: string;
  author_role: 'tc' | 'agent';
  author_label: string | null;
  body: string;
  created_at: string;
  attachment_document_id?: string | null;
  attachment?: { fileName: string; url: string | null } | null;
}

// The message thread between the coordinator and the listing agent, laid out like a deal's Messages tab: bubbles with
// the coordinator on the right in blue, a paperclip to send a file, and Enter to send. Used on both sides: `endpoint`
// is the TC route or the agent route, `self` says which side is looking. `attachTo` (the listing's documents route)
// turns on the paperclip; a sent file is also filed under the listing's Documents. `onChange` hands the messages to
// the page so it can show the same small preview beside the Documents.
export default function ListingThread({
  endpoint,
  self,
  otherLabel,
  attachTo,
  onChange,
  onFileAdded,
}: {
  endpoint: string;
  self: 'tc' | 'agent';
  otherLabel: string;
  attachTo?: string;
  onChange?: (comments: ListingThreadComment[]) => void;
  onFileAdded?: () => void;
}) {
  const [comments, setComments] = useState<ListingThreadComment[]>([]);
  const [available, setAvailable] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [pending, setPending] = useState<{ id: string; fileName: string } | null>(null);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(endpoint);
      const data = await res.json();
      if (res.ok) {
        setComments(data.comments || []);
        setAvailable(data.available !== false);
      }
    } catch {
      /* the card just stays as it was */
    }
  }, [endpoint]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
    onChangeRef.current?.(comments);
  }, [comments]);

  const attachFile = async (file: File | undefined) => {
    if (!file || !attachTo) return;
    setAttaching(true);
    setError('');
    try {
      const [uploaded] = await uploadIncoming([file]);
      const res = await authFetch(attachTo, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploads: [uploaded], documentType: 'General' }),
      });
      const row = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(row.error || 'Could not attach that file');
      setPending({ id: row.id, fileName: row.file_name || file.name });
      onFileAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach that file');
    } finally {
      setAttaching(false);
    }
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim() && !pending) return;
    setSending(true);
    setError('');
    try {
      const res = await authFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, ...(pending ? { attachmentDocumentId: pending.id } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send');
      setComments((prev) => [...prev, data]);
      setText('');
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 md:p-6 flex flex-col h-[34rem]">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-100">Messages with {otherLabel}</h2>
        <p className="text-xs text-slate-500">
          {self === 'tc'
            ? 'The listing agent can see this whole thread, including earlier messages, and gets an email that says there is a new message (not the message itself).'
            : 'Your coordinator gets an email that says there is a new message.'}
        </p>
      </div>
      {!available && <p className="text-sm text-slate-500">Messages will appear here once the latest database update has been run.</p>}
      {available && (
        <>
          <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1">
            {comments.length === 0 && <p className="text-slate-500 text-sm">No messages yet{self === 'tc' ? ' -- say hello.' : '.'}</p>}
            {comments.map((c) => {
              const mine = c.author_role === self;
              return (
                <div key={c.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${mine ? 'bg-blue-600 text-white' : 'bg-slate-800/70 text-slate-200'}`}>
                    {c.body && <p className="break-words">{c.body}</p>}
                    {c.attachment && (
                      <a
                        href={c.attachment.url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center gap-1.5 text-xs underline underline-offset-2 ${mine ? 'text-blue-100' : 'text-blue-300'} ${c.body ? 'mt-1.5' : ''}`}
                      >
                        📎 {c.attachment.fileName}
                      </a>
                    )}
                    <p className={`text-[11px] mt-1 ${mine ? 'text-blue-100/80' : 'text-slate-400'}`}>
                      {mine ? 'You' : c.author_label || otherLabel} · {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
          {attachTo && (
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                void attachFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          )}
          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
          {pending && (
            <div className="flex items-center gap-2 mb-2 text-xs text-slate-300 bg-white/5 border border-white/10 rounded-2xl px-2.5 py-1.5">
              <span className="truncate flex-1">📎 {pending.fileName}</span>
              <button type="button" onClick={() => setPending(null)} className="text-slate-500 hover:text-red-400 transition flex-shrink-0">
                ✕
              </button>
            </div>
          )}
          <form onSubmit={send} className="flex gap-2">
            {attachTo && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={attaching}
                title="Attach a file"
                className="px-3 py-2 bg-slate-600 hover:bg-slate-500 border border-slate-600 text-slate-200 rounded-lg transition disabled:opacity-50 flex-shrink-0"
              >
                {attaching ? '…' : '📎'}
              </button>
            )}
            <input
              type="text"
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={self === 'tc' ? 'Message the agent…' : 'Message your coordinator…'}
              className="flex-1 bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || (!text.trim() && !pending)}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
