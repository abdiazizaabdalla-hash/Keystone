'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';

// A small card for the dashboard: the latest posts on the team board. Renders nothing (and tells the page so) unless the person is on a team.

interface Member { userId: string; email: string; name: string; isYou: boolean }
interface BoardMessage { id: string; senderId: string; body: string; createdAt: string }

const POLL_MS = 30000;
const SHOWN = 4;

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export default function TeamBoardCard({ onAvailable }: { onAvailable?: (available: boolean) => void }) {
  const [teamName, setTeamName] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<BoardMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [ready, setReady] = useState(false);
  const availableRef = useRef(onAvailable);
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
      const [msgRes, sumRes] = await Promise.all([authFetch('/api/team/messages?thread=board'), authFetch('/api/team/messages/summary')]);
      if (msgRes.ok) setMessages(((await msgRes.json()).messages || []) as BoardMessage[]);
      if (sumRes.ok) setUnread(((await sumRes.json()).byThread || {}).board || 0);
      setReady(true);
      availableRef.current?.(true);
    } catch {
      availableRef.current?.(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    const poll = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
    };
  }, [load]);

  if (!ready) return null;
  const nameOf = (id: string) => {
    const m = members.find((x) => x.userId === id);
    if (!m) return 'Former teammate';
    return m.isYou ? 'You' : m.name || m.email.split('@')[0];
  };
  const latest = messages.slice(-SHOWN).reverse();

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100">Team board</h2>
          {teamName && <p className="text-[11px] text-slate-500 truncate">{teamName}</p>}
        </div>
        {unread > 0 && <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-semibold flex items-center justify-center">{unread > 99 ? '99+' : unread}</span>}
      </div>
      {latest.length === 0 ? (
        <p className="text-xs text-slate-400">Nothing posted yet. Share an update with the team.</p>
      ) : (
        <ul className="space-y-2.5">
          {latest.map((m) => (
            <li key={m.id} className="text-xs">
              <div className="flex items-center justify-between gap-2 text-slate-400">
                <span className="font-medium text-slate-300 truncate">{nameOf(m.senderId)}</span>
                <span className="shrink-0">{ago(m.createdAt)}</span>
              </div>
              <p className="text-slate-200 line-clamp-2 break-words">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      <Link href="/dashboard/collaborate#messages" className="block mt-3 text-xs text-blue-400 hover:text-blue-300 font-medium">
        Open team board →
      </Link>
    </div>
  );
}
