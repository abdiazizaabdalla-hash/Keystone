'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';

// On a workspace agent's home, only when they are in a brokerage: what is waiting on them and what they are waiting on, in the
// order a deal actually goes: agree the split, generate the commission invoice once a deal is closing or closed, then wait for the
// brokerage to approve and pay. Each line links to the place to act. Renders nothing otherwise.

export interface StripDeal { id: string; address: string | null; status: string | null; closingDate: string | null }
interface Row { transactionId: string; status: string; submitted?: boolean }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function AgentBrokerageStrip({ deals = [] }: { deals?: StripDeal[] }) {
  const on = isFeatureOnClient('brokerage');
  const [info, setInfo] = useState<{ name: string; rows: Row[]; unread: number; today: string; soon: string } | null>(null);

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
        if (live) setInfo({ today: new Date().toISOString().slice(0, 10), soon: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), name: body.current.owner.name, rows: ((commissions.asAgent ?? []) as Row[]).filter((r) => r.status !== 'void'), unread: Number(messages.unread ?? 0) });
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
  const { today, soon } = info;
  const invoiced = new Set(info.rows.map((r) => r.transactionId));
  const closedNoInvoice = deals.filter((d) => d.status === 'Closed' && !invoiced.has(d.id));
  const closingNoInvoice = deals.filter((d) => d.status !== 'Closed' && d.closingDate && d.closingDate >= today && d.closingDate <= soon && !invoiced.has(d.id));
  const toAgree = info.rows.filter((r) => r.status === 'proposed');
  const waitingApproval = info.rows.filter((r) => r.submitted);
  const toBePaid = info.rows.filter((r) => r.status === 'accepted');
  const deal = (id: string) => `/dashboard/transactions/${id}`;

  const todo: { text: string; href: string; tone: 'amber' | 'red' | 'slate' }[] = [
    ...(toAgree.length ? [{ text: `${plural(toAgree.length, 'commission split')} to review and agree to`, href: deal(toAgree[0].transactionId), tone: 'amber' as const }] : []),
    ...(closedNoInvoice.length ? [{ text: `${plural(closedNoInvoice.length, 'closed deal')} with no commission invoice yet. Generate ${closedNoInvoice.length === 1 ? 'it' : 'them'} to get paid`, href: deal(closedNoInvoice[0].id), tone: 'red' as const }] : []),
    ...(closingNoInvoice.length ? [{ text: `${plural(closingNoInvoice.length, 'deal')} closing within a week: generate the commission invoice so your brokerage can approve it first`, href: deal(closingNoInvoice[0].id), tone: 'amber' as const }] : []),
    ...(info.unread > 0 ? [{ text: `${plural(info.unread, 'new message')} from your brokerage`, href: '/dashboard/messages', tone: 'amber' as const }] : []),
    ...(waitingApproval.length ? [{ text: `${plural(waitingApproval.length, 'invoice')} sent, waiting for your brokerage to approve`, href: deal(waitingApproval[0].transactionId), tone: 'slate' as const }] : []),
    ...(toBePaid.length ? [{ text: `${plural(toBePaid.length, 'approved commission')} waiting to be paid`, href: deal(toBePaid[0].transactionId), tone: 'slate' as const }] : []),
  ];
  const tone = { amber: 'text-amber-300', red: 'text-red-300', slate: 'text-slate-300' } as const;

  return (
    <section className="mb-6 bg-white/5 border border-white/10 rounded-2xl px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-200"><span className="font-semibold">{info.name}</span> <span className="text-slate-400">· your brokerage</span></p>
        <Link href="/dashboard/brokerage" className="text-sm text-blue-400 hover:text-blue-300">Open →</Link>
      </div>
      {todo.length === 0 ? (
        <p className="text-sm text-slate-500 mt-1">Nothing waiting on you.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {todo.map((t) => (
            <li key={t.text}><Link href={t.href} className={`text-sm hover:underline ${tone[t.tone]}`}>{t.text}</Link></li>
          ))}
        </ul>
      )}
    </section>
  );
}
