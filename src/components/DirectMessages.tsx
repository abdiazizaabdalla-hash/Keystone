'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { Avatar } from '@/components/chat/ChatBubbles';
import { dayLabel } from '@/lib/chatFormat';

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

const clock = (value: string) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const shortWhen = (value: string) => {
  const d = new Date(value);
  return d.toDateString() === new Date().toDateString() ? clock(value) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

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
  const [query, setQuery] = useState('');
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
  const shown = (conversations ?? []).filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 mb-1">Messages</h1>
      <p className="text-slate-400 text-sm mb-5">
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
        <div className="bg-slate-900/40 border border-white/10 rounded-2xl overflow-hidden md:flex h-[calc(100vh-13rem)] min-h-[30rem]">
          {/* Chat list */}
          <div className={`${selected ? 'hidden md:flex' : 'flex'} md:w-[22rem] md:shrink-0 md:border-r border-white/10 flex-col h-full`}>
            <div className="p-4 pb-3">
              <p className="text-lg font-semibold text-slate-100 mb-3">Chats</p>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search conversations"
                className="w-full bg-white/10 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {shown.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">No one matches that search.</p>}
              {shown.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => open(c.key)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition ${selected === c.key ? 'bg-white/10' : 'hover:bg-white/5'}`}
                >
                  <Avatar name={c.label} id={c.key} size="xl" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-slate-100 font-medium truncate">{c.label}</p>
                      {c.lastMessage && <span className="shrink-0 text-[11px] text-slate-500">{shortWhen(c.lastMessage.createdAt)}</span>}
                    </div>
                    {c.lastMessage ? (
                      <p className="text-sm text-slate-400 truncate">
                        {c.lastMessage.senderRole === self ? 'You: ' : ''}
                        {c.lastMessage.body}
                      </p>
                    ) : (
                      <p className="text-sm text-slate-500 truncate">{c.subLabel || 'No messages yet'}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Conversation */}
          <div className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col h-full`}>
            {!selected ? (
              <div className="m-auto text-center p-6">
                <div className="mx-auto mb-3 h-16 w-16 rounded-full border-2 border-slate-500 flex items-center justify-center text-slate-400">
                  <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" strokeLinejoin="round" /></svg>
                </div>
                <p className="text-slate-100 font-medium">Your messages</p>
                <p className="text-sm text-slate-500 mt-1">Choose a conversation to start chatting.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
                  <button type="button" onClick={() => setSelected(null)} className="md:hidden text-slate-300 hover:text-white text-lg leading-none" aria-label="Back to chats">
                    ←
                  </button>
                  <Avatar name={threadLabel || '?'} id={selected} size="lg" />
                  <p className="text-slate-100 font-semibold truncate">{threadLabel}</p>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {messages.length === 0 && <p className="text-sm text-slate-500 text-center mt-6">No messages yet. Say hello.</p>}
                  <ul>
                    {messages.map((m, i) => {
                      const mine = m.sender_role === self;
                      const prev = messages[i - 1];
                      const next = messages[i + 1];
                      const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
                      const startsRun = newDay || prev.sender_role !== m.sender_role;
                      const endsRun = !next || next.sender_role !== m.sender_role || dayLabel(next.created_at) !== dayLabel(m.created_at);
                      return (
                        <li key={m.id} className={startsRun && !newDay ? 'mt-3' : 'mt-0.5'}>
                          {newDay && <p className="text-center text-[11px] text-slate-500 my-4">{dayLabel(m.created_at)} · {clock(m.created_at)}</p>}
                          <div className={`flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                            {!mine && (endsRun ? <Avatar name={threadLabel || '?'} id={selected} size="sm" /> : <span className="w-6 shrink-0" />)}
                            <div
                              title={clock(m.created_at)}
                              className={`max-w-[75%] px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap break-words rounded-3xl ${
                                mine ? 'bg-gradient-to-br from-blue-500 to-indigo-500 text-white' : 'bg-white/10 text-slate-100'
                              }`}
                            >
                              {m.body}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div ref={endRef} />
                </div>

                <form onSubmit={send} className="p-3">
                  <div className="flex items-center gap-2 border border-white/15 rounded-full pl-4 pr-1.5 py-1.5">
                    <input
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      maxLength={4000}
                      placeholder="Message…"
                      aria-label={`Message ${threadLabel || otherName}`}
                      className="flex-1 min-w-0 bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={sending || !text.trim()}
                      aria-label="Send"
                      className="h-8 px-4 rounded-full bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold disabled:opacity-40 transition"
                    >
                      {sending ? '…' : 'Send'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
