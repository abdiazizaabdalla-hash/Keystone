'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';
import BrokerageMessages from './BrokerageMessages';

// The Messages page for an agent with their own workspace. It is the same private conversation the brokerage owner sees
// under Collaborate → Messages, seen from the agent's side. Messages about one deal or listing live inside that deal
// or listing (the coordinator box and the client box).

export default function AgentMessagesPage() {
  const [brokerage, setBrokerage] = useState<{ name: string } | null | undefined>(undefined);
  const on = isFeatureOnClient('brokerage');

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/brokerage');
        const body = await res.json().catch(() => ({}));
        if (!cancelled) setBrokerage(res.ok && body.current ? { name: body.current.owner.name } : null);
      } catch {
        if (!cancelled) setBrokerage(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [on]);

  const empty = !on || brokerage === null;

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100">Messages</h1>
        <p className="text-slate-400 mt-1 max-w-2xl">
          {brokerage ? `Your private conversation with ${brokerage.name}.` : 'Your private conversations.'} Messages about one deal or listing are inside that deal or listing.
        </p>
      </div>
      {brokerage === undefined && on && <p className="text-sm text-slate-400">Loading…</p>}
      {brokerage && <BrokerageMessages title={`Private messages with ${brokerage.name}`} />}
      {empty && (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-sm text-slate-400">
          You are not in a brokerage yet. If a brokerage invites you, accept it on the <Link href="/dashboard/brokerage" className="text-blue-400 hover:text-blue-300">Brokerage</Link> page and your conversation with them shows up here.
          For a coordinator or a client, open the deal and use the message box there.
        </div>
      )}
    </div>
  );
}
