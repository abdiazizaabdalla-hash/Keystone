'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import ChatBubbles, { Avatar, type ChatLine } from './chat/ChatBubbles';

// The team board on the dashboard: the latest posts, with a box to post. Renders nothing (and tells the page so) unless the person is on a team.

interface Member { userId: string; email: string; name: string; isYou: boolean; kind?: 'broker' | 'agent' | 'tc' }
interface BoardMessage { id: string; senderId: string; body: string; createdAt: string }

const POLL_MS = 20000;
const SHOWN = 8;
const MAX_LENGTH = 2000;

export default function TeamBoardCard({ onAvailable }: { onAvailable?: (available: boolean) => void }) {
  const [teamName, setTeamName] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<BoardMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const availableRef = useRef(onAvailable);
  const markedRef = useRef('');
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    availableRef.current = onAvailable;
  }, [onAvailable]);

  const load = useCallback(async () => {
    try {
      const teamRes = await authFetch('/api/team');
      if (!teamRes.ok) return availableRef.current?.(false);
      const team = await teamRes.json();
      if (!team.team) return availableRef.current?.(false);
      setTeamName(team.team.name || '');
      setMembers(team.members || []);
      const msgRes = await authFetch('/api/team/messages?thread=board');
      if (msgRes.ok) {
        const list = ((await msgRes.json()).messages || []) as BoardMessage[];
        setMessages(list);
        // Seeing the posts here counts as reading them.
        const last = list[list.length - 1];
        if (last && markedRef.current !== last.createdAt) {
          markedRef.current = last.createdAt;
          authFetch('/api/team/messages/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thread: 'board', upTo: last.createdAt }) })
            .then(() => window.dispatchEvent(new Event('team-chat-read')))
            .catch(() => undefined);
        }
      }
      setReady(true);
      availableRef.current?.(true);
    } catch {
      availableRef.current?.(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
    };
  }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, ready]);

  const post = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await authFetch('/api/team/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thread: 'board', body }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not post that');
      setDraft('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post that');
    } finally {
      setSending(false);
    }
  };

  if (!ready) return null;
  const KIND = { broker: 'Broker', agent: 'Agent', tc: 'TC' } as const;
  const lines: ChatLine[] = messages.slice(-SHOWN).map((m) => {
    const who = members.find((x) => x.userId === m.senderId);
    return {
      id: m.id,
      senderKey: m.senderId,
      senderName: who ? who.name || who.email.split('@')[0] : 'Former teammate',
      mine: Boolean(who?.isYou),
      body: m.body,
      createdAt: m.createdAt,
      tag: who?.kind ? KIND[who.kind] : undefined,
    };
  });

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100">Team board</h2>
          {teamName && <p className="text-[11px] text-slate-500 truncate">{teamName} · everyone on your team sees this</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex -space-x-1.5" aria-label={`${members.length} on the team`}>
            {members.slice(0, 4).map((m) => (
              <span key={m.userId} className="rounded-full ring-2 ring-slate-900"><Avatar name={m.name || m.email} id={m.userId} size="sm" /></span>
            ))}
          </div>
          <Link href="/dashboard/collaborate#messages" className="text-xs text-blue-400 hover:text-blue-300 font-medium">Open →</Link>
        </div>
      </div>
      <div ref={listRef} className="px-4 py-3 max-h-80 overflow-y-auto bg-slate-900/30">
        {lines.length === 0 ? <p className="text-xs text-slate-400 py-2">Nothing posted yet. Share an update with the team.</p> : <ChatBubbles lines={lines} compact />}
      </div>
      <div className="px-3 py-3 border-t border-white/10">
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                post();
              }
            }}
            rows={1}
            placeholder="Post to the team…"
            aria-label="Post to the team board"
            className="flex-1 min-w-0 px-3 py-2 bg-slate-900/60 border border-slate-600 rounded-xl text-slate-100 text-xs placeholder-slate-500 focus:outline-none focus:border-blue-400 resize-none"
          />
          <button type="button" onClick={post} disabled={sending || !draft.trim()} aria-label="Post" className="shrink-0 h-8 w-8 rounded-full bg-blue-500 hover:bg-blue-400 text-white flex items-center justify-center transition disabled:opacity-40">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden><path d="M3.4 2.3a.8.8 0 0 1 .9-.1l13 7.2a.8.8 0 0 1 0 1.4l-13 7.2a.8.8 0 0 1-1.1-1L5 11H11a1 1 0 1 0 0-2H5L3.2 3.2a.8.8 0 0 1 .2-.9Z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
