'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError, clearSession } from '@/lib/authClient';
import { AGENT_FOCUS, AGENT_VOLUME, COORDINATION_MODES, type CoordinationMode } from '@/lib/accountType';
import { isFeatureOnClient } from '@/lib/features';
import { US_STATES } from '@/lib/usStates';

// Setup for an agent, in short steps. An agent on a brokerage's roster sees their brokerage and what it includes; an independent agent
// sees their own trial. Fees, checklists and Stripe are coordinator settings that an agent never needs.
const inputClass =
  'w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

export default function AgentOnboardingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<CoordinationMode | null>(null);
  const [name, setName] = useState('');
  const [brokerage, setBrokerage] = useState('');
  const [phone, setPhone] = useState('');
  const [states, setStates] = useState<string[]>([]);
  const [focus, setFocus] = useState<string[]>([]);
  const [dealsPerYear, setDealsPerYear] = useState<string | null>(null);
  const [license, setLicense] = useState('');
  const [invitedBy, setInvitedBy] = useState<string | null>(null);
  // On a brokerage roster: the brokerage provides the workspace, so there is no trial and no brokerage to type in.
  const [rosterOf, setRosterOf] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const askStates = isFeatureOnClient('templates');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/auth/me');
        if (!res.ok) throw new AuthRequiredError();
        const data = await res.json();
        if (data.isAgent) {
          router.replace('/agent');
          return;
        }
        if (data.needsOnboarding === false && data.accountType === 'agent') {
          router.replace('/dashboard');
          return;
        }
        setName(data.fullName || '');
        setLevel(data.agentLevel ?? null);
        if (isFeatureOnClient('brokerage')) {
          try {
            const inv = await authFetch('/api/brokerage');
            if (inv.ok) {
              const b = (await inv.json()) as { current?: { owner: { name: string } } | null; invites?: { owner: { name: string } }[] };
              if (b.current) {
                setRosterOf(b.current.owner.name);
                setBrokerage(b.current.owner.name);
              } else if (b.invites?.[0]) {
                setInvitedBy(b.invites[0].owner.name);
                setBrokerage((cur) => cur || b.invites![0].owner.name);
              }
            }
          } catch {
            /* the brokerage is simply not mentioned */
          }
        }
        setReady(true);
      } catch (e) {
        if (e instanceof AuthRequiredError) {
          clearSession();
          router.replace('/auth');
          return;
        }
        setReady(true);
      }
    })();
  }, [router]);

  const labels = ['About you', 'Your market', 'How you work'];
  const last = step === labels.length - 1;

  const next = () => {
    setError('');
    if (step === 0 && !name.trim()) {
      setError('Add your name to continue.');
      return;
    }
    setStep(step + 1);
  };

  const finish = async () => {
    if (!mode) {
      setError('Choose how you want to work to continue.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await authFetch('/api/agent-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, name, brokerage, phone, focus, dealsPerYear, license, ...(askStates ? { states } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not finish setup');
      router.push('/dashboard/transactions/new');
    } catch (e) {
      if (e instanceof AuthRequiredError) {
        clearSession();
        router.replace('/auth');
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not finish setup');
      setSaving(false);
    }
  };

  if (!ready) {
    return <div className="min-h-screen app-bg flex items-center justify-center text-slate-400">Loading...</div>;
  }

  const chip = (on: boolean) => `px-3.5 py-2 rounded-xl border text-sm transition ${on ? 'bg-blue-500/20 border-blue-500/50 text-blue-100' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`;
  const proViaBrokerage = Boolean(rosterOf) && level === 'pro';

  return (
    <div className="min-h-screen app-bg text-slate-100">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 bg-white rounded-lg flex items-center justify-center p-1.5 shadow-sm">
              <img src="/relay-icon.png" alt="" className="w-full h-full object-contain" />
            </span>
            <span className="font-display font-semibold text-slate-100">Relay</span>
          </div>
          <button type="button" onClick={() => { clearSession(); router.push('/auth'); }} className="text-sm text-slate-400 hover:text-slate-100 transition">Sign out</button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Agent setup · Step {step + 1} of {labels.length}</p>
        <ol className="flex gap-1.5 mb-6" aria-label="Progress">
          {labels.map((l, i) => <li key={l} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-blue-500' : 'bg-white/10'}`} aria-current={i === step ? 'step' : undefined} title={l} />)}
        </ol>

        {rosterOf && step === 0 && (
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            <p className="font-semibold">{rosterOf} set up your Relay workspace.</p>
            <p className="text-emerald-200/80 mt-0.5">It is free while you are on their roster. {proViaBrokerage ? 'Your brokerage’s plan includes automations and custom templates.' : 'Automations and custom templates are part of Agent Pro.'}</p>
          </div>
        )}

        <h1 className="font-display text-3xl font-semibold mb-5">{labels[step]}</h1>

        {step === 0 && (
          <section>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block"><span className="text-sm text-slate-400 block mb-1.5">Your name</span>
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" autoComplete="name" /></label>
              <label className="block"><span className="text-sm text-slate-400 block mb-1.5">Phone (optional)</span>
                <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" autoComplete="tel" inputMode="tel" /></label>
              <label className="block"><span className="text-sm text-slate-400 block mb-1.5">License number (optional)</span>
                <input className={inputClass} value={license} onChange={(e) => setLicense(e.target.value)} placeholder="Real estate license number" /></label>
              <label className="block"><span className="text-sm text-slate-400 block mb-1.5">Brokerage{rosterOf ? '' : ' (optional)'}</span>
                <input className={`${inputClass} ${rosterOf ? 'opacity-70' : ''}`} value={brokerage} onChange={(e) => setBrokerage(e.target.value)} readOnly={Boolean(rosterOf)} placeholder="Your brokerage" /></label>
            </div>
            {invitedBy && (
              <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 mt-4">
                {invitedBy} has invited you to join their brokerage. You can review exactly what they would see, and accept or decline, from the Brokerage page once you are set up. Nothing is shared until you accept.
              </p>
            )}
            {!rosterOf && !invitedBy && <p className="text-xs text-slate-500 mt-3">If your brokerage uses Relay, ask them to invite you and your workspace comes with it.</p>}
          </section>
        )}

        {step === 1 && (
          <section className="space-y-6">
            {askStates && (
              <div>
                <p className="text-sm font-semibold text-slate-200 mb-1">Which states do you work in?</p>
                <p className="text-xs text-slate-500 mb-2">Optional. Your Templates screen opens to these states, with links to each state’s official forms.</p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-slate-800/40 p-2">
                  {US_STATES.map((st) => {
                    const on = states.includes(st.code);
                    return <button key={st.code} type="button" aria-pressed={on} title={st.name} onClick={() => setStates((cur) => (cur.includes(st.code) ? cur.filter((c) => c !== st.code) : [...cur, st.code]))}
                      className={`px-2 py-1.5 rounded-lg border text-xs transition ${on ? 'bg-blue-500/20 border-blue-500/50 text-blue-100' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>{st.code}</button>;
                  })}
                </div>
                {states.length > 0 && <p className="text-xs text-slate-500 mt-1">{states.length} chosen</p>}
              </div>
            )}
            <div>
              <p className="text-sm font-semibold text-slate-200 mb-2">What do you mostly work on?</p>
              <div className="flex flex-wrap gap-2">
                {AGENT_FOCUS.map((f) => <button key={f.id} type="button" aria-pressed={focus.includes(f.id)} onClick={() => setFocus((cur) => (cur.includes(f.id) ? cur.filter((x) => x !== f.id) : [...cur, f.id]))} className={chip(focus.includes(f.id))}>{f.label}</button>)}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200 mb-2">About how many deals do you close in a year?</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Deals per year">
                {AGENT_VOLUME.map((v) => <button key={v.id} type="button" role="radio" aria-checked={dealsPerYear === v.id} onClick={() => setDealsPerYear(dealsPerYear === v.id ? null : v.id)} className={chip(dealsPerYear === v.id)}>{v.label}</button>)}
              </div>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <p className="text-sm text-slate-400 mb-3">Pick the closest one. It only sets up your first screens, and you can use everything in Relay either way.</p>
            <div className="grid gap-3 mb-6" role="radiogroup" aria-label="How you work">
              {COORDINATION_MODES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}
                  className={`text-left rounded-xl border px-5 py-4 transition ${mode === m.id ? 'border-blue-400 bg-blue-500/10' : 'border-white/10 bg-slate-800/50 hover:border-white/25'}`}>
                  <span className="block font-semibold text-slate-100">{m.title}</span>
                  <span className="block text-sm text-slate-400 mt-1">{m.body}</span>
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              {rosterOf
                ? <p><span className="font-semibold text-slate-100">What {rosterOf} can see.</span> The status of your deals and listings, so they can check required documents. You can review exactly what is shared on the Brokerage page at any time.</p>
                : <p><span className="font-semibold text-slate-100">Next:</span> upload your first contract and Relay builds the deal for you, with the checklist, dates and contacts filled in. Your first 14 days are free, and no card is needed.</p>}
            </div>
          </section>
        )}

        {error && <div className="mt-5 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>}

        <div className="flex items-center gap-3 mt-8">
          {step > 0 && <button type="button" onClick={() => { setError(''); setStep(step - 1); }} disabled={saving} className="px-5 py-3 border border-white/15 text-slate-200 hover:border-white/30 rounded-lg">Back</button>}
          {last
            ? <button type="button" onClick={finish} disabled={saving} className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50">{saving ? 'Setting up...' : 'Continue: upload your first contract'}</button>
            : <button type="button" onClick={next} className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition">Continue</button>}
          {step === 1 && <button type="button" onClick={() => setStep(2)} className="text-sm text-slate-400 hover:text-slate-100">Skip this step</button>}
        </div>
      </main>
    </div>
  );
}
