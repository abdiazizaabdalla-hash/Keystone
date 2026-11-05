'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import ChatBubbles, { Avatar, type ChatLine } from './chat/ChatBubbles';

// The one Messages screen, laid out like an inbox: the team board pinned at the top of the list, then the private
// conversations the viewer has. Pick one on the left, read and reply on the right. It is used by the broker (Collaborate →
// Messages: a conversation with each agent and each teammate), by an agent (Messages, and Collaborate → Messages: the board
// plus the one with their broker) and by a coordinator on the team. Private threads are readable only by the two people in
// them (the server checks every request).

interface Member { userId: string; email: string; name: string; isYou: boolean; kind?: 'broker' | 'agent' | 'tc' }
interface AgentConv { id: string; role: 'agent' | 'owner'; name: string; email: string | null; lastMessage: { fromMe: boolean; body: string; createdAt: string } | null; unread: number }
interface TeamMsg { id: string; senderId: string; recipientId: string | null; body: string; createdAt: string }
interface BrokerageMsg { id: string; sender_id: string; body: string; created_at: string }

type Thread = { kind: 'board' } | { kind: 'team'; id: string } | { kind: 'agent'; id: string };
const same = (a: Thread, b: Thread) => a.kind === b.kind && (a.kind === 'board' || (b.kind !== 'board' && a.id === b.id));

const MAX_LENGTH = 4000;
const POLL_MS = 8000;
const LIST_POLL_MS = 15000;
const KIND = { broker: 'Broker', agent: 'Agent', tc: 'TC' } as const;

function short(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Who is looking: the broker (owner), an agent in the brokerage, or a coordinator/teammate on the team. */
export type InboxViewer = 'owner' | 'agent' | 'member';

export default function MessagesInbox({ members, isOwner, viewer = isOwner ? 'owner' : 'member', onAgentUnreadChange }: { members: Member[]; isOwner: boolean; viewer?: InboxViewer; onAgentUnreadChange?: (n: number) => void }) {
  const isAgentViewer = viewer === 'agent';
  const meId = members.find((m) => m.isYou)?.userId;
  // An agent talks to their broker in private; everyone else on the board is reached by posting there.
  const teammates = useMemo(() => (isAgentViewer ? [] : members.filter((m) => !m.isYou)), [members, isAgentViewer]);
  const nameOfMember = useCallback((id: string) => {
    const m = members.find((x) => x.userId === id);
    return m ? m.name || m.email.split('@')[0] : 'Former teammate';
  }, [members]);

  const [agents, setAgents] = useState<AgentConv[]>([]);
  const [teamUnread, setTeamUnread] = useState<Record<string, number>>({});
  // /dashboard/collaborate?with=<agent id>#messages opens that agent's conversation.
  const [active, setActive] = useState<Thread>(() => {
    const w = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('with') : null;
    return w ? { kind: 'agent', id: w } : { kind: 'board' };
  });
  const [showChat, setShowChat] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('with')); // small screens: list or conversation
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [boardPreview, setBoardPreview] = useState<{ who: string; body: string; at: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const activeRef = useRef(active);
  const notifyRef = useRef(onAgentUnreadChange);
  useEffect(() => {
    activeRef.current = active;
    notifyRef.current = onAgentUnreadChange;
  }, [active, onAgentUnreadChange]);

  const loadLists = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([authFetch('/api/brokerage-messages'), authFetch('/api/team/messages/summary')]);
      if (a.ok) {
        const json = await a.json();
        const list: AgentConv[] = (json.conversations ?? []).filter((c: AgentConv) => c.role === (isAgentViewer ? 'owner' : 'agent'));
        setAgents(list);
        const cur = activeRef.current;
        notifyRef.current?.(list.reduce((n, c) => n + (cur.kind === 'agent' && cur.id === c.id ? 0 : c.unread), 0));
      }
      if (t.ok) setTeamUnread((await t.json()).byThread ?? {});
    } catch {
      /* the list just does not refresh this round */
    }
  }, [isAgentViewer]);

  const toTeamLines = useCallback((list: TeamMsg[], thread: Thread): ChatLine[] => list.map((m) => {
    const who = members.find((x) => x.userId === m.senderId);
    return {
      id: m.id,
      senderKey: m.senderId,
      senderName: nameOfMember(m.senderId),
      mine: m.senderId === meId,
      body: m.body,
      createdAt: m.createdAt,
      tag: thread.kind === 'board' && who?.kind ? KIND[who.kind] : undefined,
      canDelete: m.senderId === meId || (isOwner && m.recipientId === null),
    };
  }), [members, meId, nameOfMember, isOwner]);

  const toAgentLines = useCallback((list: BrokerageMsg[], otherId: string, otherName: string): ChatLine[] => list.map((m) => ({
    id: m.id,
    senderKey: m.sender_id,
    senderName: m.sender_id === otherId ? otherName : 'You',
    mine: m.sender_id !== otherId,
    body: m.body,
    createdAt: m.created_at,
    tag: m.sender_id === otherId ? (isAgentViewer ? 'Broker' : 'Agent') : undefined,
  })), [isAgentViewer]);

  const loadThread = useCallback(async (thread: Thread, first: boolean) => {
    if (first) { setLoading(true); setLines([]); setError(''); stick.current = true; }
    try {
      if (thread.kind === 'agent') {
        const res = await authFetch(`/api/brokerage-messages?with=${encodeURIComponent(thread.id)}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not load this conversation');
        if (same(activeRef.current, thread)) setLines(toAgentLines(json.messages ?? [], thread.id, json.name ?? 'Agent'));
        // Opening the thread marks what they sent as read on the server; tell the sidebar so its unread count drops.
        if (((json.messages ?? []) as { sender_id: string; read_at: string | null }[]).some((m) => m.sender_id !== meId && !m.read_at)) window.dispatchEvent(new Event('team-chat-read'));
      } else {
        const key = thread.kind === 'board' ? 'board' : thread.id;
        const res = await authFetch(`/api/team/messages?thread=${encodeURIComponent(key)}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not load messages');
        const list = (json.messages ?? []) as TeamMsg[];
        if (same(activeRef.current, thread)) setLines(toTeamLines(list, thread));
        const last = list[list.length - 1];
        if (thread.kind === 'board' && last) setBoardPreview({ who: last.senderId === meId ? 'You' : nameOfMember(last.senderId), body: last.body, at: last.createdAt });
        if (last) {
          authFetch('/api/team/messages/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thread: key, upTo: last.createdAt }) })
            .then(() => { window.dispatchEvent(new Event('team-chat-read')); setTeamUnread((u) => { const n = { ...u }; delete n[key]; return n; }); })
            .catch(() => undefined);
        }
      }
      setError('');
    } catch (e) {
      if (first) setError(e instanceof Error ? e.message : 'Could not load this conversation');
    } finally {
      if (first) setLoading(false);
    }
  }, [toAgentLines, toTeamLines, meId, nameOfMember]);

  useEffect(() => {
    const t = setTimeout(() => loadThread(active, true).then(loadLists), 0);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') loadThread(active, false); }, POLL_MS);
    return () => { clearTimeout(t); clearInterval(poll); };
  }, [active, loadThread, loadLists]);

  useEffect(() => {
    const t = setTimeout(loadLists, 0);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') loadLists(); }, LIST_POLL_MS);
    return () => { clearTimeout(t); clearInterval(poll); };
  }, [loadLists]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines, loading]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const res = active.kind === 'agent'
        ? await authFetch('/api/brokerage-messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ with: active.id, body }) })
        : await authFetch('/api/team/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thread: active.kind === 'board' ? 'board' : active.id, body }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not send that');
      setDraft('');
      stick.current = true;
      await loadThread(active, false);
      loadLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that');
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this message for everyone?')) return;
    try {
      const res = await authFetch(`/api/team/messages/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not delete that message');
      setLines((l) => l.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that message');
    }
  };

  const open = (t: Thread) => { setActive(t); setShowChat(true); setDraft(''); };
  const badge = (n: number) => (n > 0 ? <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-blue-500 text-white text-xs font-semibold flex items-center justify-center">{n > 99 ? '99+' : n}</span> : null);
  const agentName = active.kind === 'agent' ? agents.find((a) => a.id === active.id)?.name ?? (isAgentViewer ? 'Your broker' : 'Agent') : '';
  const title = active.kind === 'board' ? 'Team board' : active.kind === 'agent' ? agentName : nameOfMember(active.id);
  const subtitle = active.kind === 'board' ? (isAgentViewer ? 'Visible to everyone in the brokerage' : 'Visible to everyone on your team') : 'Private: only the two of you can read this';
  const boardUnread = teamUnread['board'] || 0;

  const row = (t: Thread, selected: boolean, left: React.ReactNode, name: string, preview: string, time: string | null, count: number) => (
    <button key={t.kind === 'board' ? 'board' : `${t.kind}-${t.id}`} type="button" onClick={() => open(t)} className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-white/5 transition ${selected ? 'bg-blue-500/15' : 'hover:bg-white/5'}`}>
      {left}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm ${count > 0 ? 'font-semibold text-slate-50' : 'font-medium text-slate-100'}`}>{name}</span>
          {time && <span className="shrink-0 text-[11px] text-slate-500">{time}</span>}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={`truncate text-xs ${count > 0 ? 'text-slate-200' : 'text-slate-400'}`}>{preview}</span>
          {!selected && badge(count)}
        </span>
      </span>
    </button>
  );

  const sectionLabel = (text: string) => <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-slate-500">{text}</p>;

  return (
    <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg overflow-hidden mb-6">
      <div className="px-4 md:px-6 py-4 border-b border-slate-600">
        <h2 className="font-display font-semibold text-slate-100">Messages</h2>
        <p className="text-xs text-slate-400 mt-0.5">{isAgentViewer ? 'The team board is seen by the whole brokerage. Messages with your broker are private between the two of you.' : 'The team board is seen by your whole team. Messages with an agent or teammate are private between the two of you.'}</p>
      </div>

      <div className="md:flex md:h-[36rem]">
        <div className={`${showChat ? 'hidden' : 'block'} md:block md:w-80 md:shrink-0 md:border-r border-slate-600 overflow-y-auto max-h-[32rem] md:max-h-none`}>
          {row({ kind: 'board' }, active.kind === 'board', <span className="h-10 w-10 shrink-0 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center" aria-hidden><svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M2 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V5Z" /></svg></span>, 'Team board', boardPreview ? `${boardPreview.who}: ${boardPreview.body}` : 'Posts for the whole team', boardPreview ? short(boardPreview.at) : null, boardUnread)}

          {sectionLabel(isAgentViewer ? 'Private messages · your broker' : 'Private messages · agents')}
          {agents.length === 0 ? (
            <p className="px-4 py-2 text-xs text-slate-500">{isAgentViewer ? 'Your broker’s messages show up here.' : 'Once an agent joins your brokerage you can message them privately here.'}</p>
          ) : (
            agents.map((a) => row({ kind: 'agent', id: a.id }, active.kind === 'agent' && active.id === a.id, <Avatar name={a.name} id={a.id} size="lg" />, a.name, a.lastMessage ? `${a.lastMessage.fromMe ? 'You: ' : ''}${a.lastMessage.body}` : 'No messages yet', a.lastMessage ? short(a.lastMessage.createdAt) : null, a.unread))
          )}

          {teammates.length > 0 && sectionLabel('Private messages · teammates')}
          {teammates.map((m) => row({ kind: 'team', id: m.userId }, active.kind === 'team' && active.id === m.userId, <Avatar name={m.name || m.email} id={m.userId} size="lg" />, m.name || m.email.split('@')[0], m.kind ? KIND[m.kind] : 'Teammate', null, teamUnread[m.userId] || 0))}
        </div>

        <div className={`${showChat ? 'flex' : 'hidden'} md:flex flex-1 min-w-0 flex-col`}>
          <div className="px-4 md:px-5 py-3 border-b border-slate-600 flex items-center gap-3">
            <button type="button" onClick={() => setShowChat(false)} className="md:hidden text-sm text-blue-300" aria-label="Back to the list">← Back</button>
            {active.kind === 'board' ? (
              <span className="h-9 w-9 shrink-0 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center" aria-hidden><svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M2 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V5Z" /></svg></span>
            ) : (
              <Avatar name={title} id={active.id} size="lg" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100 truncate">{title}</p>
              <p className="text-[11px] text-slate-400">{subtitle}</p>
            </div>
          </div>

          <div ref={scrollRef} onScroll={() => { const el = scrollRef.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="flex-1 overflow-y-auto px-4 md:px-5 py-4 h-72 md:h-auto bg-slate-900/20">
            {loading && <p className="text-sm text-slate-400">Loading…</p>}
            {!loading && lines.length === 0 && !error && (
              <p className="text-sm text-slate-400">{active.kind === 'board' ? 'Nothing on the board yet. Post an update for the whole team.' : `No messages with ${title} yet. Say hello.`}</p>
            )}
            {lines.length > 0 && <ChatBubbles lines={lines} onDelete={remove} />}
          </div>

          <div className="border-t border-slate-600 p-3">
            {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
            <div className="flex gap-2 items-end">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                rows={2}
                placeholder={active.kind === 'board' ? 'Post to the team board… (Enter to send)' : `Message ${title}… (Enter to send)`}
                aria-label="Write a message"
                className="flex-1 min-w-0 px-3 py-2 bg-slate-900/60 border border-slate-600 rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-400 resize-none"
              />
              <button type="button" onClick={send} disabled={sending || !draft.trim()} className="shrink-0 px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-xl transition disabled:opacity-50">{sending ? 'Sending…' : 'Send'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
