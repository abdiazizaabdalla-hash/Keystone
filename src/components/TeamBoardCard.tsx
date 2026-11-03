'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';

// The team board on the dashboard: the latest posts, with a box to post. Renders nothing (and tells the page so) unless the person is on a team.

interface Member { userId: string; email: string; name: string; isYou: boolean }
interface BoardMessage { id: string; senderId: string; body: string; createdAt: string }

const POLL_MS = 20000;
const SHOWN = 8;
const MAX_LENGTH = 2000;

function when(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

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
  const listRef = useRef<HTMLUListElement | null>(null);
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
  const nameOf = (id: string) => {
    const m = members.find((x) => x.userId === id);
    if (!m) return 'Former teammate';
    return m.isYou ? 'You' : m.name || m.email.split('@')[0];
  };
  const latest = messages.slice(-SHOWN);

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100">Team board</h2>
          {teamName && <p className="text-[11px] text-slate-500 truncate">{teamName} · everyone on your team sees this</p>}
        </div>
        <Link href="/dashboard/collaborate#messages" className="shrink-0 text-xs text-blue-400 hover:text-blue-300 font-medium">Open →</Link>
      </div>
      {latest.length === 0 ? (
        <p className="text-xs text-slate-400 mb-3">Nothing posted yet. Share an update with the team.</p>
      ) : (
        <ul ref={listRef} className="space-y-3 mb-3 max-h-80 overflow-y-auto pr-1">
          {latest.map((m) => (
            <li key={m.id} className="text-xs">
              <div className="flex items-center justify-between gap-2 text-slate-400">
                <span className={`font-medium truncate ${nameOf(m.senderId) === 'You' ? 'text-blue-300' : 'text-slate-300'}`}>{nameOf(m.senderId)}</span>
                <span className="shrink-0">{when(m.createdAt)}</span>
              </div>
              <p className="text-slate-200 whitespace-pre-wrap break-words">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            post();
          }
        }}
        rows={2}
        placeholder="Post to the team… (Enter to send)"
        className="w-full px-3 py-2 bg-slate-900/60 border border-slate-600 rounded-lg text-slate-100 text-xs placeholder-slate-500 focus:outline-none focus:border-blue-400 resize-none"
      />
      <button type="button" onClick={post} disabled={sending || !draft.trim()} className="mt-2 w-full px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50">
        {sending ? 'Posting…' : 'Post'}
      </button>
    </div>
  );
}
