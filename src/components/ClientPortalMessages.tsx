'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Channel = 'board' | 'agent' | 'tc';

interface PortalMessage {
  id: string;
  body: string;
  createdAt: string;
  senderType: 'client' | 'agent' | 'tc';
  senderName: string | null;
  mine: boolean;
}

const POLL_MS = 8000;

// The client's messages on the public progress page: a shared board that
// everyone on the deal can read, plus a private thread with the agent and
// one with the coordinator. The progress-link token is their identity.
export default function ClientPortalMessages({
  token,
  agentName,
  tcName,
}: {
  token: string;
  agentName: string | null;
  tcName: string | null;
}) {
  const [channel, setChannel] = useState<Channel>('board');
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const agentLabel = agentName || 'your agent';
  const tcLabel = tcName || 'your coordinator';

  const tabs: { key: Channel; label: string; hint: string }[] = [
    { key: 'board', label: 'General board', hint: 'Everyone on this transaction can read this: you, your agent and the coordinator.' },
    { key: 'agent', label: `Private: ${agentLabel} (Agent)`, hint: `Only you and ${agentLabel} can see this thread.` },
    { key: 'tc', label: `Private: ${tcLabel} (Coordinator)`, hint: `Only you and ${tcLabel} can see this thread.` },
  ];
  const active = tabs.find((t) => t.key === channel)!;

  const load = useCallback(
    async (which: Channel) => {
      try {
        const res = await fetch(`/api/external/${token}/messages?channel=${which}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.messages)) setMessages(data.messages);
      } catch {
        // quiet: this also runs on a timer
      } finally {
        setLoaded(true);
      }
    },
    [token]
  );

  useEffect(() => {
    let cancelled = false;
    // Clear when switching threads so a stale list never shows under the wrong tab.
    Promise.resolve().then(() => {
      if (cancelled) return;
      setMessages([]);
      setLoaded(false);
      stickToBottom.current = true;
      void load(channel);
    });
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load(channel);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [channel, load]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    try {
      setSending(true);
      setError('');
      const res = await fetch(`/api/external/${token}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, body: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send your message');
      stickToBottom.current = true;
      setMessages((prev) => [...prev, data]);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your message');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
      <h2 className="text-slate-100 font-semibold mb-3">Messages</h2>
      <div className="flex flex-wrap gap-2 mb-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={channel === t.key}
            onClick={() => setChannel(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              channel === t.key ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mb-3">{active.hint}</p>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="h-72 overflow-y-auto space-y-3 mb-3 pr-1"
      >
        {loaded && messages.length === 0 && <p className="text-sm text-slate-500">No messages yet. Say hello.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                m.mine ? 'bg-blue-500 text-white' : 'bg-slate-700/70 text-slate-100'
              }`}
            >
              {!m.mine && (
                <p className="text-[11px] font-semibold text-slate-300 mb-0.5">
                  {m.senderName || 'Team'}
                  {m.senderType === 'agent' ? ' · Agent' : m.senderType === 'tc' ? ' · Coordinator' : m.senderType === 'client' ? ' · Client' : ''}
                </p>
              )}
              {m.body}
              <p className={`text-[10px] mt-1 ${m.mine ? 'text-blue-100/80' : 'text-slate-400'}`}>
                {new Date(m.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          maxLength={4000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          aria-label="Write a message"
          placeholder={channel === 'board' ? 'Post to the board…' : `Message ${channel === 'agent' ? agentLabel : tcLabel}…`}
          className="flex-1 bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !draft.trim()}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
