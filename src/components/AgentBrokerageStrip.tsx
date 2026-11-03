'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';

// On a workspace agent's home: a single line about their brokerage, only when they are in one: what is waiting on them
// (a commission split to agree to, an unread message) and a link to the Brokerage page. Renders nothing otherwise.

export default function AgentBrokerageStrip() {
  const on = isFeatureOnClient('brokerage');
  const [info, setInfo] = useState<{ name: string; toAgree: number; unread: number } | null>(null);

  useEffect(() => {
    if (!on) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/brokerage');
        if (!res.ok) return;
        const body = await res.json();
        if (!body.current) return;
        const [c, m] = await Promise.all([authFetch('/api/commissions'), authFetch('/api/brokerage-messages')]);
        const commissions = c.ok ? await c.json() : {};
        const messages = m.ok ? await m.json() : {};
        const toAgree = ((commissions.asAgent ?? []) as { status: string }[]).filter((r) => r.status === 'proposed').length;
        if (live) setInfo({ name: body.current.owner.name, toAgree, unread: Number(messages.unread ?? 0) });
      } catch {
        /* the strip just does not show */
      }
    }, 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [on]);

  if (!info) return null;
  const waiting = [
    info.toAgree > 0 ? `${info.toAgree} commission split${info.toAgree === 1 ? '' : 's'} to review` : '',
    info.unread > 0 ? `${info.unread} new message${info.unread === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  return (
    <Link href="/dashboard/brokerage" className="mb-6 flex flex-wrap items-center justify-between gap-2 bg-white/5 border border-white/10 hover:border-white/25 rounded-2xl px-5 py-3 transition">
      <span className="text-sm text-slate-200"><span className="font-semibold">{info.name}</span> <span className="text-slate-400">· your brokerage</span></span>
      <span className="text-sm">
        {waiting.length > 0 ? <span className="text-amber-300">{waiting.join(' · ')}</span> : <span className="text-slate-500">Nothing waiting on you</span>}
        <span className="ml-3 text-blue-400">Open →</span>
      </span>
    </Link>
  );
}
