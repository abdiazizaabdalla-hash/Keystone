'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

interface Conversation {
  key: string;
  label: string;
  subLabel: string | null;
  lastMessage: { senderRole: 'tc' | 'agent'; body: string; createdAt: string } | null;
}
interface Msg {
  id: string;
  sender_role: 'tc' | 'agent';
  body: string;
  created_at: string;
}

const formatWhen = (value: string) =>
  new Date(value).toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * The Messages tab for both sides: general conversations between a coordinator and an agent. Messages about a
 * specific deal or listing live inside that deal or listing instead.
 */
export default function DirectMessages({ self, loginPath }: { self: 'tc' | 'agent'; loginPath: string }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [threadLabel, setThreadLabel] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const guard = useCallback(
    (err: unknown) => {
      if (err instanceof AuthRequiredError) {
        router.push(loginPath);
        return true;
      }
      return false;
    },
    [router, loginPath]
  );

  const loadList = useCallback(async () => {
    try {
      const res = await authFetch('/api/direct-messages');
      if (!res.ok) throw new Error('Failed to load messages');
      const json = await res.json();
      setConversations(Array.isArray(json.conversations) ? json.conversations : []);
    } catch (err) {
      if (!guard(err)) setError('Could not load your conversations.');
    }
  }, [guard]);

  const loadThread = useCallback(
    async (key: string) => {
      try {
        const res = await authFetch(`/api/direct-messages?with=${encodeURIComponent(key)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load this conversation');
        setMessages(json.messages || []);
        setThreadLabel(json.label || '');
      } catch (err) {
        if (!guard(err)) setError(err instanceof Error ? err.message : 'Failed to load this conversation');
      }
    },
    [guard]
  );

  useEffect(() => {
    const t = setTimeout(loadList, 0);
    return () => clearTimeout(t);
  }, [loadList]);

  // Pick up new messages while a conversation is open.
  useEffect(() => {
    if (!selected) return;
    const first = setTimeout(() => loadThread(selected), 0);
    const timer = setInterval(() => loadThread(selected), 15000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [selected, loadThread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, selected]);

  const open = (key: string) => {
    setError('');
    setMessages([]);
    setThreadLabel(conversations?.find((c) => c.key === key)?.label || '');
    setSelected(key);
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !text.trim()) return;
    setSending(true);
    setError('');
    try {
      const res = await authFetch('/api/direct-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ with: selected, body: text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not send');
      setMessages((prev) => [...prev, json]);
      setText('');
      loadList();
    } catch (err) {
      if (!guard(err)) setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setSending(false);
    }
  };

  const otherName = self === 'tc' ? 'agent' : 'coordinator';

  return (
    <div className="min-h-screen px-4 py-6 md:px-6 md:py-12">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-display font-semibold text-slate-100 mb-1">Messages</h1>
        <p className="text-slate-400 text-sm mb-6">
          General conversations with your {otherName}. Messages about a particular deal or listing are inside that deal or listing.
        </p>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        {conversations === null && !error && <p className="text-slate-500 text-sm">Loading…</p>}

        {conversations !== null && conversations.length === 0 && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
            <p className="text-slate-400 text-sm">
              {self === 'tc'
                ? 'No agents to message yet. Add an agent with an email address and they will show up here.'
                : 'No conversations yet. They appear here once a coordinator adds you.'}
            </p>
          </div>
        )}

        {conversations !== null && conversations.length > 0 && (
          <div className="grid md:grid-cols-[18rem_1fr] gap-4">
            <div className={`${selected ? 'hidden md:block' : ''} bg-white/5 border border-white/10 rounded-2xl divide-y divide-slate-600 self-start overflow-hidden`}>
              {conversations.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => open(c.key)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-slate-700/40 transition ${selected === c.key ? 'bg-slate-700/60' : ''}`}
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
                    {c.label[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-100 font-medium truncate">{c.label}</p>
                    {c.lastMessage ? (
                      <p className="text-xs text-slate-400 truncate">
                        {c.lastMessage.senderRole === self ? 'You: ' : ''}
                        {c.lastMessage.body}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500 italic truncate">{c.subLabel || 'No messages yet'}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div className={`${selected ? '' : 'hidden md:flex'} bg-white/5 border border-white/10 rounded-2xl flex flex-col min-h-[24rem]`}>
              {!selected ? (
                <p className="m-auto text-sm text-slate-500 p-6">Choose a conversation.</p>
              ) : (
                <>
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-600">
                    <button type="button" onClick={() => setSelected(null)} className="md:hidden text-slate-400 hover:text-slate-200 text-sm">
                      ← Back
                    </button>
                    <p className="text-slate-100 font-semibold truncate">{threadLabel}</p>
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 max-h-[28rem]">
                    {messages.length === 0 && <p className="text-sm text-slate-500 italic">No messages yet. Say hello.</p>}
                    {messages.map((m) => {
                      const mine = m.sender_role === self;
                      return (
                        <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-100'}`}>
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            <p className={`text-[10px] mt-1 ${mine ? 'text-blue-100/80' : 'text-slate-400'}`}>{formatWhen(m.created_at)}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={endRef} />
                  </div>
                  <form onSubmit={send} className="flex gap-2 p-3 border-t border-slate-600">
                    <input
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      maxLength={4000}
                      placeholder={`Message ${threadLabel || otherName}…`}
                      className="flex-1 min-w-0 bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                    <button type="submit" disabled={sending || !text.trim()} className="px-4 py-2 bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                      {sending ? 'Sending…' : 'Send'}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
