'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError, clearSession } from '@/lib/authClient';
import { DOCUMENT_CATEGORIES } from '@/lib/documentTaxonomy';

// Setup for a brokerage owner. Nothing here is about fees, invoices or Stripe: those belong to coordinators. A brokerage sets up
// who it is, which documents every file must hold, the steps every file starts with, the office automations, and its agents.
// Every step saves as it goes, using the same endpoints as the Compliance, Automations and Roster screens, so it can all be changed later.

const inputClass = 'w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';
const STEPS = ['Your brokerage', 'Required documents', 'Steps on every file', 'Office automations', 'Invite your agents'];

interface Step { name: string; dueDays: number | null }
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
  const [required, setRequired] = useState<string[]>([]);
  const [txSteps, setTxSteps] = useState<Step[]>([]);
  const [listSteps, setListSteps] = useState<Step[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [emails, setEmails] = useState('');
  const [inviteResults, setInviteResults] = useState<{ email: string; ok: boolean; message: string }[]>([]);

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
        const rs = await authFetch('/api/oversight/required-steps');
        if (rs.ok) {
          const b = (await rs.json()) as { transaction: Step[]; listing: Step[] };
          setTxSteps(b.transaction);
          setListSteps(b.listing);
        }
        const au = await authFetch('/api/brokerage/automations');
        if (au.ok) setAutomations(((await au.json()) as { automations: Automation[] }).automations);
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
        await call('/api/oversight/required-steps', 'PUT', { kind: 'transaction', steps: txSteps });
        await call('/api/oversight/required-steps', 'PUT', { kind: 'listing', steps: listSteps });
      } else if (step === 3) {
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

  const invite = async () => {
    const list = [...new Set(emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))];
    if (!list.length) return;
    setSaving(true);
    const out: { email: string; ok: boolean; message: string }[] = [];
    for (const email of list) {
      try { await call('/api/oversight', 'POST', { email }); out.push({ email, ok: true, message: 'Invited' }); }
      catch (e) { out.push({ email, ok: false, message: e instanceof Error ? e.message : 'Could not invite' }); }
    }
    setInviteResults(out);
    setEmails(out.filter((r) => !r.ok).map((r) => r.email).join('\n'));
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
  const removeStep = (kind: 'tx' | 'list', i: number) => (kind === 'tx' ? setTxSteps((s) => s.filter((_, j) => j !== i)) : setListSteps((s) => s.filter((_, j) => j !== i)));

  const stepList = (kind: 'tx' | 'list', items: Step[]) => (
    <ul className="space-y-1.5">
      {items.map((s, i) => (
        <li key={`${s.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
          <span className="flex-1 text-slate-100">{s.name}</span>
          <span className="text-xs text-slate-400">{s.dueDays === null ? 'No due date' : `${s.dueDays} days`}</span>
          <button type="button" onClick={() => removeStep(kind, i)} className="text-xs text-slate-400 hover:text-red-300" aria-label={`Remove ${s.name}`}>Remove</button>
        </li>
      ))}
      {items.length === 0 && <li className="text-sm text-slate-500">No steps. Files start with Relay’s own checklist only.</li>}
    </ul>
  );

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

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Set up your brokerage · Step {step + 1} of {STEPS.length}</p>
        <ol className="flex gap-1.5 mb-8" aria-label="Progress">
          {STEPS.map((label, i) => <li key={label} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-blue-500' : 'bg-white/10'}`} aria-current={i === step ? 'step' : undefined} title={label} />)}
        </ol>
        <h1 className="font-display text-3xl font-semibold mb-2">{STEPS[step]}</h1>

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
            <p className="text-slate-400 mb-2">Choose the documents every file must contain. Relay checks each agent’s files against this list and flags what is missing on your compliance desk.</p>
            <p className="text-xs text-slate-500 mb-5">You can change this any time. Brokerage Pro can also keep separate lists by deal type.</p>
            <div className="space-y-5">
              {categories.map((c) => (
                <div key={c.key}>
                  <p className="text-sm font-semibold text-slate-200 mb-2">{c.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {c.types.map((t) => {
                      const on = required.includes(t);
                      return <button key={t} type="button" aria-pressed={on} onClick={() => toggleType(t)}
                        className={`px-3 py-1.5 rounded-lg border text-sm transition ${on ? 'bg-blue-500/20 border-blue-500/50 text-blue-100' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>{on ? '✓ ' : ''}{t}</button>;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-4">{required.length} required. Skip this if you want to decide later.</p>
          </section>
        )}

        {step === 2 && (
          <section>
            <p className="text-slate-400 mb-6">These steps are added to every new file your agents open, so every deal starts with the same checks. Remove any you do not want. You can add your own later under Compliance.</p>
            <p className="text-sm font-semibold text-slate-200 mb-2">Transactions</p>{stepList('tx', txSteps)}
            <p className="text-sm font-semibold text-slate-200 mt-6 mb-2">Listings</p>{stepList('list', listSteps)}
          </section>
        )}

        {step === 3 && (
          <section>
            <p className="text-slate-400 mb-6">Relay can watch every agent’s files for you and tell you, or the agent, when something needs attention. Switch on the ones you want. Each runs on its own once on.</p>
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

        {step === 4 && (
          <section>
            <p className="text-slate-400 mb-4">Invite your agents by email. They get a free Relay workspace while they are on your roster, and nothing is shared with you until they accept.</p>
            <textarea className={`${inputClass} min-h-32`} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={'agent@example.com\nanother@example.com'} aria-label="Agent emails" />
            <div className="flex items-center gap-3 mt-3">
              <button type="button" onClick={invite} disabled={saving || !emails.trim()} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg disabled:opacity-50">Send invitations</button>
              <span className="text-xs text-slate-500">Separate addresses with a comma or a new line.</span>
            </div>
            {inviteResults.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm">
                {inviteResults.map((r) => <li key={r.email} className={r.ok ? 'text-emerald-300' : 'text-red-300'}>{r.ok ? '✓' : '✗'} {r.email}: {r.message}</li>)}
              </ul>
            )}
          </section>
        )}

        {error && <div className="mt-6 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>}

        <div className="flex items-center gap-3 mt-10">
          {step > 0 && <button type="button" onClick={() => { setError(''); setStep(step - 1); }} disabled={saving} className="px-5 py-3 border border-white/15 text-slate-200 hover:border-white/30 rounded-lg">Back</button>}
          {last
            ? <button type="button" onClick={finish} disabled={saving} className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg disabled:opacity-50">{saving ? 'Finishing...' : 'Go to your dashboard'}</button>
            : <button type="button" onClick={next} disabled={saving} className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg disabled:opacity-50">{saving ? 'Saving...' : 'Continue'}</button>}
          {step >= 1 && !last && <button type="button" onClick={() => setStep(step + 1)} disabled={saving} className="text-sm text-slate-400 hover:text-slate-100">Skip for now</button>}
        </div>
      </main>
    </div>
  );
}
