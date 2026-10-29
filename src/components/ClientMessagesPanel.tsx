'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authClient';

interface ClientRef {
  id: string;
  name: string;
  email: string | null;
}

interface Row {
  id: string;
  link_id: string | null;
  sender_type: 'client' | 'agent' | 'tc';
  sender_name: string | null;
  body: string;
  created_at: string;
}

const POLL_MS = 8000;

// The agent's and TC's side of client messaging: the shared board, plus a
// private thread with each client. An agent's private thread and a TC's
// private thread with the same client are separate; neither can read the
// other's (enforced by /api/client-messages, not just hidden here).
export default function ClientMessagesPanel({
  transactionId,
  viewerRole,
}: {
  transactionId: string;
  viewerRole: 'agent' | 'tc';
}) {
  const [clients, setClients] = useState<ClientRef[]>([]);
  const [tab, setTab] = useState<string>('board'); // 'board' or a client's link id
  const [messages, setMessages] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const load = useCallback(
    async (which: string) => {
      try {
        const qs =
          which === 'board'
            ? `channel=board`
            : `channel=private&linkId=${encodeURIComponent(which)}`;
        const res = await authFetch(`/api/client-messages?transactionId=${transactionId}&${qs}`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.clients)) {
          setClients(data.clients);
          // A client whose link was turned off drops out of the tabs; fall back to the board.
          if (which !== 'board' && !data.clients.some((c: ClientRef) => c.id === which)) setTab('board');
        }
        if (Array.isArray(data.messages)) setMessages(data.messages);
      } catch {
        // quiet: this also runs on a timer
      } finally {
        setLoaded(true);
      }
    },
    [transactionId]
  );

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setMessages([]);
      stickToBottom.current = true;
      void load(tab);
    });
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void load(tab);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tab, load]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const activeClient = clients.find((c) => c.id === tab) || null;
  const otherParty = viewerRole === 'agent' ? 'the coordinator' : 'the agent';
  const hint =
    tab === 'board'
      ? `Everyone on this deal reads the board: the client(s), the agent and the coordinator.`
      : `Private between you and ${activeClient?.name || 'the client'}. ${otherParty.charAt(0).toUpperCase()}${otherParty.slice(1)} cannot see this thread.`;

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    try {
      setSending(true);
      setError('');
      const res = await authFetch('/api/client-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          tab === 'board'
            ? { transactionId, channel: 'board', body: text }
            : { transactionId, channel: 'private', linkId: tab, body: text }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send');
      stickToBottom.current = true;
      setMessages((prev) => [...prev, data]);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="bg-white/5 border border-white/10 rounded-2xl p-6" data-testid="client-messages">
      <h2 className="text-lg font-bold text-slate-100 mb-1">Client Messages</h2>
      {loaded && clients.length === 0 ? (
        <p className="text-sm text-slate-500">
          Add a client under Client Access to start a board and private threads with them.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mt-3 mb-2" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'board'}
              onClick={() => setTab('board')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                tab === 'board' ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              General board
            </button>
            {clients.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={tab === c.id}
                onClick={() => setTab(c.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  tab === c.id ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                Private: {c.name}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mb-3">{hint}</p>

          <div
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="h-64 overflow-y-auto space-y-3 mb-3 pr-1"
          >
            {loaded && messages.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
            {messages.map((m) => {
              const mine = m.sender_type === viewerRole;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      mine ? 'bg-blue-500 text-white' : 'bg-slate-700/70 text-slate-100'
                    }`}
                  >
                    {!mine && (
                      <p className="text-[11px] font-semibold text-slate-300 mb-0.5">
                        {m.sender_name || (m.sender_type === 'client' ? 'Client' : m.sender_type === 'agent' ? 'Agent' : 'Coordinator')}
                        {m.sender_type === 'client' ? ' · Client' : m.sender_type === 'agent' ? ' · Agent' : ' · Coordinator'}
                      </p>
                    )}
                    {mine && tab === 'board' && m.sender_name && <p className="text-[11px] font-semibold text-blue-100/90 mb-0.5">You</p>}
                    {m.body}
                    <p className={`text-[10px] mt-1 ${mine ? 'text-blue-100/80' : 'text-slate-400'}`}>
                      {new Date(m.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
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
              placeholder={tab === 'board' ? 'Post to the board…' : `Message ${activeClient?.name || 'client'} privately…`}
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
        </>
      )}
    </section>
  );
}
