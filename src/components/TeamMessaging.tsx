'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '@/lib/authClient';

interface ChatMember {
  userId: string;
  email: string;
  name: string;
  role: 'owner' | 'member';
  isYou: boolean;
}

interface ChatMessage {
  id: string;
  senderId: string;
  recipientId: string | null;
  body: string;
  createdAt: string;
}

const BOARD = 'board';
const MAX_LENGTH = 2000;
const MESSAGE_POLL_MS = 8000;
const SUMMARY_POLL_MS = 15000;

function displayName(member: ChatMember | undefined): string {
  if (!member) return 'Former teammate';
  return member.name || member.email.split('@')[0] || member.email;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Team chat for the Collaborate page: a shared team board plus direct
 * messages between teammates. Plain polling (no realtime subscription) so
 * everything goes through the server-side membership checks.
 */
export default function TeamMessaging({ members, isOwner }: { members: ChatMember[]; isOwner: boolean }) {
  const me = members.find((m) => m.isYou);
  const teammates = useMemo(() => members.filter((m) => !m.isYou), [members]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members]);

  const [activeThread, setActiveThread] = useState<string>(BOARD);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState<Record<string, number>>({});

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const latestRef = useRef<string | null>(null);
  const activeRef = useRef(activeThread);
  useEffect(() => {
    activeRef.current = activeThread;
  }, [activeThread]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await authFetch('/api/team/messages/summary');
      if (!res.ok) return;
      const json = await res.json();
      setUnread(json.byThread || {});
    } catch {
      // Non-fatal: unread dots just don't update this round.
    }
  }, []);

  const markRead = useCallback(
    async (thread: string, upTo: string) => {
      try {
        await authFetch('/api/team/messages/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ thread, upTo }),
        });
        setUnread((prev) => {
          if (!prev[thread]) return prev;
          const next = { ...prev };
          delete next[thread];
          return next;
        });
        // Tell the sidebar badge to refresh right away.
        window.dispatchEvent(new Event('team-chat-read'));
      } catch {
        // Non-fatal.
      }
    },
    []
  );

  // Initial load whenever the conversation changes.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      setMessages([]);
      latestRef.current = null;
      stickToBottom.current = true;
      try {
        const res = await authFetch(`/api/team/messages?thread=${encodeURIComponent(activeThread)}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || 'Could not load messages.');
          return;
        }
        const list = json.messages as ChatMessage[];
        setMessages(list);
        const last = list[list.length - 1];
        latestRef.current = last ? last.createdAt : null;
        if (last) markRead(activeThread, last.createdAt);
      } catch {
        if (!cancelled) setError('Could not load messages.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeThread, markRead]);

  // Poll for new messages in the open conversation while the tab is visible.
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const thread = activeRef.current;
      const since = latestRef.current;
      try {
        const url = since
          ? `/api/team/messages?thread=${encodeURIComponent(thread)}&since=${encodeURIComponent(since)}`
          : `/api/team/messages?thread=${encodeURIComponent(thread)}`;
        const res = await authFetch(url);
        if (!res.ok || activeRef.current !== thread) return;
        const json = await res.json();
        const incoming = json.messages as ChatMessage[];
        if (incoming.length === 0) return;
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const fresh = incoming.filter((m) => !seen.has(m.id));
          return fresh.length ? (since ? [...prev, ...fresh] : incoming) : prev;
        });
        const last = incoming[incoming.length - 1];
        latestRef.current = last.createdAt;
        markRead(thread, last.createdAt);
      } catch {
        // Try again next tick.
      }
    };
    const id = window.setInterval(tick, MESSAGE_POLL_MS);
    return () => window.clearInterval(id);
  }, [markRead]);

  // Unread counts for the other conversations.
  useEffect(() => {
    const first = window.setTimeout(loadSummary, 0);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadSummary();
    }, SUMMARY_POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [loadSummary]);

  // Keep the newest message in view unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await authFetch('/api/team/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread: activeThread, body }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not send your message.');
        return;
      }
      const sent = json.message as ChatMessage;
      stickToBottom.current = true;
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      latestRef.current = sent.createdAt;
      setDraft('');
      markRead(activeThread, sent.createdAt);
    } catch {
      setError('Could not send your message.');
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this message for everyone?')) return;
    try {
      const res = await authFetch(`/api/team/messages/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Could not delete that message.');
        return;
      }
      setMessages((prev) => prev.filter((m) => m.id !== id));
    } catch {
      setError('Could not delete that message.');
    }
  };

  const activeMember = activeThread === BOARD ? undefined : memberById.get(activeThread);
  const boardUnread = unread[BOARD] || 0;

  const tabClass = (active: boolean) =>
    `flex items-center justify-between gap-2 w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition ${
      active ? 'bg-blue-600 text-white' : 'text-slate-200 hover:bg-slate-700'
    }`;

  const badge = (n: number) =>
    n > 0 ? (
      <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-semibold flex items-center justify-center">
        {n > 99 ? '99+' : n}
      </span>
    ) : null;

  return (
    <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg overflow-hidden mb-6">
      <div className="px-4 md:px-6 py-4 border-b border-slate-600">
        <h2 className="font-display font-semibold text-slate-100">Team messages</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          The team board is seen by everyone on your team. Direct messages are only between the two of you.
        </p>
      </div>

      <div className="md:flex md:h-[30rem]">
        {/* Conversation list */}
        <div className="md:w-56 md:shrink-0 md:border-r border-slate-600 p-3 border-b md:border-b-0 space-y-1 md:overflow-y-auto max-h-48 md:max-h-none overflow-y-auto">
          <button type="button" onClick={() => setActiveThread(BOARD)} className={tabClass(activeThread === BOARD)}>
            <span className="truncate">Team board</span>
            {activeThread !== BOARD && badge(boardUnread)}
          </button>
          {teammates.length > 0 && (
            <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-slate-500">Direct messages</p>
          )}
          {teammates.map((m) => (
            <button
              key={m.userId}
              type="button"
              onClick={() => setActiveThread(m.userId)}
              className={tabClass(activeThread === m.userId)}
            >
              <span className="truncate">{displayName(m)}</span>
              {activeThread !== m.userId && badge(unread[m.userId] || 0)}
            </button>
          ))}
          {teammates.length === 0 && (
            <p className="px-3 pt-2 text-xs text-slate-500">
              Invite a teammate below and you can message them directly here.
            </p>
          )}
        </div>

        {/* Conversation */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-4 md:px-5 py-3 border-b border-slate-600 text-sm text-slate-300">
            {activeThread === BOARD ? (
              <span>
                <span className="font-semibold text-slate-100">Team board</span> · visible to the whole team
              </span>
            ) : (
              <span>
                <span className="font-semibold text-slate-100">{displayName(activeMember)}</span> · private between you
                two
              </span>
            )}
          </div>

          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-4 md:px-5 py-4 space-y-3 h-72 md:h-auto"
          >
            {loading && <p className="text-sm text-slate-400">Loading…</p>}
            {!loading && messages.length === 0 && !error && (
              <p className="text-sm text-slate-400">
                {activeThread === BOARD
                  ? 'Nothing on the board yet. Post an update for the whole team.'
                  : `No messages with ${displayName(activeMember)} yet. Say hello.`}
              </p>
            )}
            {messages.map((m) => {
              const mine = m.senderId === me?.userId;
              const sender = memberById.get(m.senderId);
              const canDelete = mine || (isOwner && m.recipientId === null);
              return (
                <div key={m.id} className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                    <div className="text-[11px] text-slate-400 mb-0.5 flex items-center gap-2">
                      {!mine && <span className="font-medium text-slate-300">{displayName(sender)}</span>}
                      <span>{formatTime(m.createdAt)}</span>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => remove(m.id)}
                          className="text-slate-500 hover:text-red-400 md:opacity-0 md:group-hover:opacity-100 transition"
                          aria-label="Delete message"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    <div
                      className={`px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                        mine ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-slate-600 text-slate-100 rounded-bl-sm'
                      }`}
                    >
                      {m.body}
                    </div>
                  </div>
                </div>
              );
            })}
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
                placeholder={
                  activeThread === BOARD
                    ? 'Post to the team board… (Enter to send, Shift+Enter for a new line)'
                    : `Message ${displayName(activeMember)}…`
                }
                className="flex-1 min-w-0 px-3 py-2 bg-slate-900/60 border border-slate-600 rounded-lg text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-400 resize-none"
              />
              <button
                type="button"
                onClick={send}
                disabled={sending || !draft.trim()}
                className="shrink-0 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
            {draft.length > MAX_LENGTH - 200 && (
              <p className="text-[11px] text-slate-500 mt-1 text-right">
                {draft.length}/{MAX_LENGTH}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
