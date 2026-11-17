'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError, clearSession } from '@/lib/authClient';
import { DOCUMENT_CATEGORIES } from '@/lib/documentTaxonomy';

// Setup for a brokerage owner. Nothing here is about fees, invoices or Stripe: those belong to coordinators. A brokerage sets up
// who it is, which documents every file must hold, the steps every file starts with, the office automations, and its agents.
// Every step saves as it goes, using the same endpoints as the Compliance, Automations and Roster screens, so it can all be changed later.

const inputClass = 'w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';
const STEPS = ['Your brokerage', 'Required documents', 'Office automations', 'Invite your agents'];

interface Automation { kind: string; name: string; blurb: string; enabled: boolean; settings: Record<string, number> }

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`shrink-0 w-11 h-6 rounded-full transition relative ${on ? 'bg-blue-500' : 'bg-slate-600'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export default function BrokerageOnboardingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [fullName, setFullName] = useState('');
  const [brokerageName, setBrokerageName] = useState('');
  const [required, setRequired] = useState<string[]>(() => DOCUMENT_CATEGORIES.flatMap((c) => c.types).filter((t) => t !== 'General'));
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [agentEmails, setAgentEmails] = useState<string[]>(['', '', '']);
  const [seats, setSeats] = useState<{ tier: 'basic' | 'pro'; limit: number; used: number } | null>(null);
  const [inviteResults, setInviteResults] = useState<Record<number, { ok: boolean; message: string }>>({});

  const categories = useMemo(() => DOCUMENT_CATEGORIES.map((c) => ({ key: c.key, label: c.label, types: c.types.filter((t) => t !== 'General') })).filter((c) => c.types.length > 0), []);

  useEffect(() => {
    (async () => {
      try {
        const me = await authFetch('/api/auth/me');
        if (!me.ok) throw new AuthRequiredError();
        const data = await me.json();
        if (data.isAgent) { router.replace('/agent'); return; }
        if (data.needsOnboarding === false) { router.replace('/dashboard'); return; }
        setFullName(data.fullName || '');
        const check = await authFetch('/api/oversight?check=1');
        if (!check.ok) { router.replace('/onboarding'); return; }
        const team = await authFetch('/api/team');
        if (team.ok) setBrokerageName(((await team.json()) as { team?: { name?: string | null } }).team?.name ?? '');
        const au = await authFetch('/api/brokerage/automations');
        if (au.ok) setAutomations(((await au.json()) as { automations: Automation[] }).automations.map((a) => ({ ...a, enabled: true })));
        const acct = await authFetch('/api/brokerage/account');
        if (acct.ok) {
          const a = ((await acct.json()) as { account: { tier: 'basic' | 'pro'; seats: { active: number; pending: number; limit: number } } | null }).account;
          if (a) setSeats({ tier: a.tier, limit: a.seats.limit, used: a.seats.active + a.seats.pending });
        }
        setReady(true);
      } catch (e) {
        if (e instanceof AuthRequiredError) { clearSession(); router.replace('/auth'); return; }
        setReady(true);
      }
    })();
  }, [router]);

  const call = async (url: string, method: string, body: unknown) => {
    const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || 'Could not save');
    return data;
  };

  const next = async () => {
    setError('');
    setSaving(true);
    try {
      if (step === 0) {
        if (!brokerageName.trim()) throw new Error('Enter your brokerage name to continue.');
        await call('/api/team', 'PATCH', { name: brokerageName });
        if (fullName.trim()) await call('/api/auth/me', 'PATCH', { fullName });
      } else if (step === 1) {
        await call('/api/oversight/file-review/requirements', 'PUT', { types: required });
      } else if (step === 2) {
        for (const a of automations) await call('/api/brokerage/automations', 'PUT', { kind: a.kind, enabled: a.enabled, params: a.settings });
      }
      setStep(step + 1);
    } catch (e) {
      if (e instanceof AuthRequiredError) { clearSession(); router.replace('/auth'); return; }
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const openSeats = seats ? Math.max(seats.limit - seats.used, 0) : 10;
  const invite = async () => {
    setSaving(true);
    const out: Record<number, { ok: boolean; message: string }> = {};
    for (let i = 0; i < agentEmails.length; i++) {
      const email = agentEmails[i].trim().toLowerCase();
      if (!email.includes('@')) continue;
      try { await call('/api/oversight', 'POST', { email }); out[i] = { ok: true, message: 'Invitation sent' }; }
      catch (e) { out[i] = { ok: false, message: e instanceof Error ? e.message : 'Could not invite' }; }
    }
    setInviteResults(out);
    setSaving(false);
  };

  const finish = async () => {
    setSaving(true);
    setError('');
    try {
      await call('/api/auth/me', 'PATCH', { onboardingCompleted: true });
      router.push('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finish');
      setSaving(false);
    }
  };

  if (!ready) return <div className="min-h-screen app-bg flex items-center justify-center text-slate-400">Loading...</div>;

  const last = step === STEPS.length - 1;
  const toggleType = (t: string) => setRequired((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  return (
    <div className="min-h-screen app-bg text-slate-100">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 bg-white rounded-lg flex items-center justify-center p-1.5"><img src="/relay-icon.png" alt="" className="w-full h-full object-contain" /></span>
            <span className="font-display font-semibold">Relay</span>
          </div>
          <button type="button" onClick={() => { clearSession(); router.push('/auth'); }} className="text-sm text-slate-400 hover:text-slate-100">Sign out</button>
        </div>
      </header>

      <main className={`${step === 1 ? 'max-w-6xl' : 'max-w-3xl'} mx-auto px-4 sm:px-6 py-6`}>
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Set up your brokerage · Step {step + 1} of {STEPS.length}</p>
        <ol className="flex gap-1.5 mb-8" aria-label="Progress">
          {STEPS.map((label, i) => <li key={label} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-blue-500' : 'bg-white/10'}`} aria-current={i === step ? 'step' : undefined} title={label} />)}
        </ol>
        <div className="flex items-center justify-between gap-4 mb-2">
          <h1 className="font-display text-3xl font-semibold">{STEPS[step]}</h1>
          {step >= 1 && step < STEPS.length - 1 && <button type="button" onClick={() => { setError(''); setStep(step + 1); }} disabled={saving} className="shrink-0 text-sm text-slate-400 hover:text-slate-100 underline underline-offset-4">Skip this step</button>}
        </div>

        {step === 0 && (
          <section>
            <p className="text-slate-400 mb-6">This is how your brokerage appears to your agents, in invitations and on your dashboard.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block sm:col-span-2"><span className="text-sm text-slate-400 block mb-1.5">Brokerage name</span>
                <input className={inputClass} value={brokerageName} onChange={(e) => setBrokerageName(e.target.value)} placeholder="Your brokerage" /></label>
              <label className="block sm:col-span-2"><span className="text-sm text-slate-400 block mb-1.5">Your name</span>
                <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Broker or owner name" autoComplete="name" /></label>
            </div>
          </section>
        )}

        {step === 1 && (
          <section>
            <p className="text-slate-400 text-sm mb-4">Every document is ticked to start. Untick any you do not require. Relay flags missing ones on your compliance desk, and you can change this any time. <span className="text-slate-300">{required.length} chosen.</span></p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {categories.map((c) => {
                const all = c.types.every((t) => required.includes(t));
                return (
                  <div key={c.key} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-slate-100">{c.label}</p>
                      <button type="button" onClick={() => setRequired((cur) => (all ? cur.filter((t) => !c.types.includes(t)) : [...new Set([...cur, ...c.types])]))} className="text-xs text-blue-300 hover:text-blue-200">{all ? 'Clear all' : 'Select all'}</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.types.map((t) => {
                        const on = required.includes(t);
                        return <button key={t} type="button" aria-pressed={on} onClick={() => toggleType(t)}
                          className={`px-2 py-1 rounded-md border text-xs transition ${on ? 'bg-blue-500/25 border-blue-400/60 text-blue-100' : 'bg-transparent border-white/10 text-slate-400 hover:bg-white/10'}`}>{t}</button>;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <p className="text-slate-400 mb-6">Relay can watch every agent’s files for you and tell you, or the agent, when something needs attention. They are all on to start. Switch off any you do not want. Each runs on its own once on.</p>
            <ul className="space-y-3">
              {automations.map((a) => (
                <li key={a.kind} className="flex items-start gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex-1"><p className="font-semibold text-slate-100">{a.name}</p><p className="text-sm text-slate-400 mt-0.5">{a.blurb}</p></div>
                  <Toggle on={a.enabled} label={a.name} onClick={() => setAutomations((cur) => cur.map((x) => (x.kind === a.kind ? { ...x, enabled: !x.enabled } : x)))} />
                </li>
              ))}
              {automations.length === 0 && <li className="text-sm text-slate-500">Automations are not available on this account yet.</li>}
            </ul>
          </section>
        )}

        {step === 3 && (
          <section>
            <p className="text-slate-400 mb-3">Each agent gets a free Relay workspace while on your roster, and nothing is shared with you until they accept.</p>
            <div className="grid sm:grid-cols-2 gap-3 mb-4 text-sm">
              <div className={`rounded-xl border p-3 ${seats?.tier === 'basic' ? 'border-blue-400 bg-blue-500/10' : 'border-white/10 bg-white/5'}`}><p className="font-semibold text-slate-100">Brokerage Basic</p><p className="text-slate-400">10 agents included, extra agents $8 a month</p></div>
              <div className={`rounded-xl border p-3 ${seats?.tier === 'pro' ? 'border-blue-400 bg-blue-500/10' : 'border-white/10 bg-white/5'}`}><p className="font-semibold text-slate-100">Brokerage Pro</p><p className="text-slate-400">25 agents included, extra agents $6 a month</p></div>
            </div>
            {seats && <p className="text-sm text-slate-300 mb-3">Your plan includes {seats.limit} agents. {openSeats} {openSeats === 1 ? 'seat is' : 'seats are'} open.</p>}
            <div className="space-y-2">
              {agentEmails.map((v, i) => (
                <div key={i} className="flex items-center gap-3">
                  <input type="email" className={inputClass} value={v} onChange={(e) => setAgentEmails((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Agent ${i + 1} email`} aria-label={`Agent ${i + 1} email`} />
                  {inviteResults[i] && <span className={`text-xs whitespace-nowrap ${inviteResults[i].ok ? 'text-emerald-300' : 'text-red-300'}`}>{inviteResults[i].ok ? '✓ ' : ''}{inviteResults[i].message}</span>}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button type="button" onClick={() => setAgentEmails((cur) => [...cur, ''])} disabled={agentEmails.length >= Math.max(openSeats, 1)} className="text-sm text-blue-300 hover:text-blue-200 disabled:opacity-40">+ Add another agent</button>
              <button type="button" onClick={invite} disabled={saving || !agentEmails.some((e) => e.includes('@'))} className="ml-auto px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg disabled:opacity-50">Send invitations</button>
            </div>
          </section>
        )}

        {error && <div className="mt-6 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>}

        <div className="flex items-center gap-3 mt-10">
          {step > 0 && <button type="button" onClick={() => { setError(''); setStep(step - 1); }} disabled={saving} className="px-5 py-3 border border-white/15 text-slate-200 hover:border-white/30 rounded-lg">Back</button>}
          {last
            ? <button type="button" onClick={finish} disabled={saving} className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg disabled:opacity-50">{saving ? 'Finishing...' : 'Go to your dashboard'}</button>
            : <button type="button" onClick={next} disabled={saving} className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg disabled:opacity-50">{saving ? 'Saving...' : 'Continue'}</button>}
        </div>
      </main>
    </div>
  );
}
