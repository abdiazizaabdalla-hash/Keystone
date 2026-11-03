'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { Avatar } from './chat/ChatBubbles';

// Everyone in the brokerage, sorted into agents, coordinators and other. Adding, inviting and removing people happens in
// Collaborate; this is the quick list, with a link there. "Other" (people who are not members) is passed in as children.

interface Member { userId: string; email: string; name: string; kind?: 'broker' | 'agent' | 'tc'; isYou: boolean }
interface BrokerageAgent { linkId: string; userId: string | null; name: string; email: string; status: string }
interface PendingInvite { id: string; email: string }
interface Team { team: { name: string | null } | null; members: Member[]; pendingInvites?: PendingInvite[]; brokerageAgents?: BrokerageAgent[] }

function Group({ title, count, href, hrefLabel, children, empty }: { title: string; count: number; href: string; hrefLabel: string; children: React.ReactNode; empty: string }) {
  return (
    <section className="bg-white/5 border border-white/10 rounded-2xl p-5" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-base font-semibold text-slate-100">{title} <span className="text-slate-500 font-normal">· {count}</span></h2>
        <Link href={href} className="text-sm text-blue-400 hover:text-blue-300">{hrefLabel}</Link>
      </div>
      {count === 0 ? <p className="text-sm text-slate-400">{empty}</p> : <ul className="divide-y divide-white/5">{children}</ul>}
    </section>
  );
}

function Row({ id, name, email, note, href }: { id: string; name: string; email: string; note?: string; href?: string }) {
  const inner = (
    <>
      <Avatar name={name || email} id={id} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-slate-100 truncate">{name || email}</span>
        <span className="block text-xs text-slate-400 truncate">{email}</span>
      </span>
      {note && <span className="shrink-0 text-xs text-slate-400">{note}</span>}
    </>
  );
  return <li>{href ? <Link href={href} className="flex items-center gap-3 py-2 hover:bg-white/5 rounded-lg px-1 -mx-1">{inner}</Link> : <div className="flex items-center gap-3 py-2">{inner}</div>}</li>;
}

export default function MembersPanel({ other }: { other: React.ReactNode }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/team');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Could not load your members');
        setTeam(json as Team);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load your members');
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  if (error) return <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>;
  if (!team) return <p className="text-sm text-slate-400">Loading…</p>;

  const joined = (team.brokerageAgents ?? []).filter((a) => a.status === 'active');
  const invited = (team.brokerageAgents ?? []).filter((a) => a.status === 'pending');
  const teamAgents = team.members.filter((m) => !m.isYou && m.kind === 'agent');
  const coordinators = team.members.filter((m) => !m.isYou && m.kind !== 'agent' && m.kind !== 'broker');

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">Everyone in your brokerage. To invite someone, change a role or remove them, open <Link href="/dashboard/collaborate#people" className="text-blue-400 hover:text-blue-300">Collaborate</Link>.</p>

      <Group title="Agents" count={joined.length + teamAgents.length + invited.length} href="/dashboard/collaborate#agents" hrefLabel="Invite or manage in Collaborate →" empty="No agents yet. Invite an agent from Collaborate.">
        {joined.map((a) => <Row key={a.linkId} id={a.userId ?? a.linkId} name={a.name} email={a.email} note="Profile →" href={a.userId ? `/dashboard/collaborate/agents/${a.userId}` : undefined} />)}
        {teamAgents.map((m) => <Row key={m.userId} id={m.userId} name={m.name} email={m.email} note="On your team" />)}
        {invited.map((a) => <Row key={a.linkId} id={a.linkId} name={a.email} email="Invitation sent" note="Waiting" />)}
      </Group>

      <Group title="Coordinators" count={coordinators.length + (team.pendingInvites?.length ?? 0)} href="/dashboard/collaborate#people" hrefLabel="Invite or manage in Collaborate →" empty="No coordinators yet. Invite a transaction coordinator from Collaborate.">
        {coordinators.map((m) => <Row key={m.userId} id={m.userId} name={m.name} email={m.email} note="Transaction coordinator" />)}
        {(team.pendingInvites ?? []).map((p) => <Row key={p.id} id={p.id} name={p.email} email="Invitation sent" note="Waiting" />)}
      </Group>

      <section aria-label="Other">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-slate-100">Other</h2>
          <p className="text-sm text-slate-400">Agents and contacts you work with who are not members of your brokerage. Their fees are used on the deals you coordinate for them.</p>
        </div>
        {other}
      </section>
    </div>
  );
}
