'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authClient';

interface Comment {
  id: string;
  author_role: 'tc' | 'agent';
  author_label: string | null;
  body: string;
  created_at: string;
}

// A short message thread between the coordinator and the listing agent. Used on both sides:
// `endpoint` is the TC route or the agent route, `self` says which side is looking.
export default function ListingThread({ endpoint, self, otherLabel }: { endpoint: string; self: 'tc' | 'agent'; otherLabel: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [available, setAvailable] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

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
  }, [comments.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError('');
    try {
      const res = await authFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send');
      setComments((prev) => [...prev, data]);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
      <h2 className="text-lg font-bold text-slate-100">Messages with {otherLabel}</h2>
      <p className="text-xs text-slate-500 mb-3">Keep it short. {self === 'tc' ? 'The listing agent can see this whole thread, including earlier messages, and gets an email that says there is a new message (not the message itself).' : 'Your coordinator gets an email that says there is a new message.'}</p>
      {!available && <p className="text-sm text-slate-500">Messages will appear here once the latest database update has been run.</p>}
      {available && (
        <>
          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {comments.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
            {comments.map((c) => {
              const mine = c.author_role === self;
              return (
                <div key={c.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-blue-600/30 text-slate-100' : 'bg-slate-700/60 text-slate-200'}`}>
                    <p className="whitespace-pre-wrap break-words">{c.body}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {mine ? 'You' : c.author_label || otherLabel} · {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
          <form onSubmit={send} className="mt-3 space-y-2">
            <textarea
              className="w-full bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              rows={2}
              maxLength={2000}
              placeholder="Write a message…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={sending || !text.trim()} className="px-4 py-2 bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
