'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';
import MessagesInbox from './MessagesInbox';

// The Messages page for an agent with their own workspace. It is the same screen the broker has under Collaborate →
// Messages (the brokerage's team board and a private conversation), seen from the agent's side. Messages about one deal or
// listing live inside that deal or listing.

type Members = Parameters<typeof MessagesInbox>[0]['members'];

export default function AgentMessagesPage() {
  const on = isFeatureOnClient('brokerage');
  const [state, setState] = useState<{ members: Members; viewer: 'agent' | 'member' } | null | undefined>(undefined);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/team');
        const body = await res.json().catch(() => ({}));
        if (!cancelled) setState(res.ok && body.team ? { members: body.members ?? [], viewer: body.viaBrokerage ? 'agent' : 'member' } : null);
      } catch {
        if (!cancelled) setState(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [on]);

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 mb-4">Messages</h1>
      {(!on || state === null) && <p className="text-sm text-slate-400">Join a brokerage to message your broker and team here. Messages about a deal are inside that deal.</p>}
      {on && state === undefined && <p className="text-sm text-slate-400">Loading…</p>}
      {state && <MessagesInbox members={state.members} isOwner={false} viewer={state.viewer} />}
    </div>
  );
}
