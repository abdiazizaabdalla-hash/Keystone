'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import ChatBubbles, { type ChatLine } from './chat/ChatBubbles';

// Private messages between a brokerage owner and one agent. Owners see one conversation per agent; an agent sees one with their broker.
// Only those two people can read a thread (the rest of the team cannot). Plain polling, like the team board.

interface Conversation {
  id: string;
  role: 'agent' | 'owner';
  name: string;
  email: string | null;
  lastMessage: { fromMe: boolean; body: string; createdAt: string } | null;
  unread: number;
}
interface Msg { id: string; sender_id: string; body: string; created_at: string }

const MAX_LENGTH = 4000;
const POLL_MS = 8000;

export default function BrokerageMessages({ title, onUnreadChange }: { title?: string; onUnreadChange?: (n: number) => void }) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<string | null>(null);
  const notifyRef = useRef(onUnreadChange);
  useEffect(() => {
    notifyRef.current = onUnreadChange;
  }, [onUnreadChange]);

  const loadList = useCallback(async () => {
    try {
      const res = await authFetch('/api/brokerage-messages');
      if (!res.ok) return;
      const json = await res.json();
      const list: Conversation[] = json.conversations ?? [];
      setConversations(list);
      notifyRef.current?.(list.reduce((n, c) => n + (c.id === activeRef.current ? 0 : c.unread), 0));
      setActive((cur) => cur ?? list[0]?.id ?? null);
    } catch {
      /* the list just does not refresh this round */
    }
  }, []);

  const loadThread = useCallback(async (id: string, first: boolean) => {
    if (first) setLoadingThread(true);
    try {
      const res = await authFetch(`/api/brokerage-messages?with=${encodeURIComponent(id)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not load this conversation');
      if (activeRef.current === id) setMessages(json.messages ?? []);
      setError('');
    } catch (e) {
      if (first) setError(e instanceof Error ? e.message : 'Could not load this conversation');
    } finally {
      if (first) setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    activeRef.current = active;
    if (!active) return;
    const t = setTimeout(() => {
      setMessages([]);
      loadThread(active, true).then(loadList);
    }, 0);
    const poll = setInterval(() => {
      loadThread(active, false);
      loadList();
    }, POLL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
    };
  }, [active, loadThread, loadList]);

  useEffect(() => {
    const t = setTimeout(loadList, 0);
    return () => clearTimeout(t);
  }, [loadList]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, active]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !active || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await authFetch('/api/brokerage-messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ with: active, body: text }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not send that message');
      setDraft('');
      await loadThread(active, false);
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that message');
    } finally {
      setSending(false);
    }
  };

  if (conversations === null) return null;
  const activeConv = conversations.find((c) => c.id === active);
  const single = conversations.length === 1 && conversations[0].role === 'owner';

  const badge = (n: number) =>
    n > 0 ? <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-semibold flex items-center justify-center">{n > 99 ? '99+' : n}</span> : null;

  return (
    <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg overflow-hidden mb-6">
      <div className="px-4 md:px-6 py-4 border-b border-slate-600">
        <h2 className="font-display font-semibold text-slate-100">{title ?? 'Private messages with your agents'}</h2>
        <p className="text-xs text-slate-400 mt-0.5">One-to-one and private: only you and that agent can read these. They are not shown to the rest of your team.</p>
      </div>

      {conversations.length === 0 ? (
        <p className="px-4 md:px-6 py-6 text-sm text-slate-400">No one to message yet. Once an agent accepts your brokerage invitation, you can message them privately here.</p>
      ) : (
        <div className="md:flex md:h-[28rem]">
          {!single && (
            <div className="md:w-56 md:shrink-0 md:border-r border-slate-600 p-3 border-b md:border-b-0 space-y-1 md:overflow-y-auto max-h-48 md:max-h-none overflow-y-auto">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActive(c.id)}
                  className={`flex items-center justify-between gap-2 w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition ${active === c.id ? 'bg-blue-600 text-white' : 'text-slate-200 hover:bg-slate-700'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{c.name}</span>
                    {c.lastMessage && <span className={`block truncate text-[11px] font-normal ${active === c.id ? 'text-blue-100' : 'text-slate-400'}`}>{c.lastMessage.fromMe ? 'You: ' : ''}{c.lastMessage.body}</span>}
                  </span>
                  {active !== c.id && badge(c.unread)}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-4 md:px-5 py-3 border-b border-slate-600 text-sm text-slate-300">
              <span className="font-semibold text-slate-100">{activeConv?.name ?? ''}</span>
              {activeConv?.role === 'owner' ? ' · your brokerage' : ''} · private between you two
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-5 py-4 space-y-3 h-72 md:h-auto">
              {loadingThread && <p className="text-sm text-slate-400">Loading…</p>}
              {!loadingThread && messages.length === 0 && !error && <p className="text-sm text-slate-400">No messages with {activeConv?.name ?? 'them'} yet. Say hello.</p>}
              {messages.length > 0 && (
                <ChatBubbles
                  lines={messages.map((m): ChatLine => ({ id: m.id, senderKey: m.sender_id, senderName: m.sender_id === active ? activeConv?.name ?? 'Them' : 'You', mine: m.sender_id !== active, body: m.body, createdAt: m.created_at, tag: m.sender_id === active ? (activeConv?.role === 'owner' ? 'Broker' : 'Agent') : undefined }))}
                />
              )}
            </div>
            <div className="border-t border-slate-600 p-3">
              {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
              <div className="flex gap-2 items-end">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={2}
                  placeholder={`Message ${activeConv?.name ?? ''}… (Enter to send, Shift+Enter for a new line)`}
                  className="flex-1 min-w-0 px-3 py-2 bg-slate-900/60 border border-slate-600 rounded-lg text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-400 resize-none"
                />
                <button type="button" onClick={send} disabled={sending || !draft.trim() || !active} className="shrink-0 px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50">
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
