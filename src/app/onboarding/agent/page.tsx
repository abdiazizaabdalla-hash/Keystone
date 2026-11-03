'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError, clearSession } from '@/lib/authClient';
import { COORDINATION_MODES, type CoordinationMode } from '@/lib/accountType';
import { isFeatureOnClient } from '@/lib/features';
import { US_STATES } from '@/lib/usStates';

// A short setup for an agent running their own deals: how do you want to
// work, who are you, then straight to uploading the first contract. Nothing
// else is asked up front -- fees, checklists and payments are coordinator
// settings that an agent never needs.
const inputClass =
  'w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

export default function AgentOnboardingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<CoordinationMode | null>(null);
  const [name, setName] = useState('');
  const [brokerage, setBrokerage] = useState('');
  const [phone, setPhone] = useState('');
  const [states, setStates] = useState<string[]>([]);
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

  const finish = async () => {
    if (!mode) {
      setError('Choose how you want to work to continue.');
      return;
    }
    if (!name.trim()) {
      setError('Add your name to continue.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await authFetch('/api/agent-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, name, brokerage, phone, ...(askStates ? { states } : {}) }),
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

  return (
    <div className="min-h-screen app-bg text-slate-100">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 bg-white rounded-lg flex items-center justify-center p-1.5 shadow-sm">
              <img src="/relay-icon.png" alt="" className="w-full h-full object-contain" />
            </span>
            <span className="font-display font-semibold text-slate-100">Relay TC</span>
          </div>
          <button
            type="button"
            onClick={() => {
              clearSession();
              router.push('/auth');
            }}
            className="text-sm text-slate-400 hover:text-slate-100 transition"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Welcome to Relay</p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold mb-2">How do you want to work?</h1>
        <p className="text-slate-400 mb-8">
          Pick the closest one. It only sets up your first screens, and you can use everything in Relay either way.
        </p>

        <div className="grid gap-3 mb-10" role="radiogroup" aria-label="How you work">
          {COORDINATION_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`text-left rounded-xl border px-5 py-4 transition ${
                mode === m.id ? 'border-blue-400 bg-blue-500/10' : 'border-white/10 bg-slate-800/50 hover:border-white/25'
              }`}
            >
              <span className="block font-semibold text-slate-100">{m.title}</span>
              <span className="block text-sm text-slate-400 mt-1">{m.body}</span>
            </button>
          ))}
        </div>

        <h2 className="font-display text-xl font-semibold mb-4">About you</h2>
        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          <label className="block">
            <span className="text-sm text-slate-400 block mb-1.5">Your name</span>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" autoComplete="name" />
          </label>
          <label className="block">
            <span className="text-sm text-slate-400 block mb-1.5">Brokerage (optional)</span>
            <input className={inputClass} value={brokerage} onChange={(e) => setBrokerage(e.target.value)} placeholder="Your brokerage" />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm text-slate-400 block mb-1.5">Phone (optional)</span>
            <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" autoComplete="tel" inputMode="tel" />
          </label>
        </div>

        {askStates && (
          <section className="mb-8">
            <h2 className="font-display text-xl font-semibold mb-1">Which states do you work in?</h2>
            <p className="text-sm text-slate-400 mb-3">
              Optional. Tick any that apply and your Templates screen opens to those states, with links to each state’s official forms. You can change this any time.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-slate-800/40 p-2">
              {US_STATES.map((st) => {
                const on = states.includes(st.code);
                return (
                  <button
                    key={st.code}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setStates((cur) => (cur.includes(st.code) ? cur.filter((c) => c !== st.code) : [...cur, st.code]))}
                    className={`flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg border text-sm transition ${on ? 'bg-blue-500/20 border-blue-500/50 text-blue-100' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}
                  >
                    <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${on ? 'bg-blue-500 border-blue-500 text-white' : 'border-slate-500'}`}>{on ? '✓' : ''}</span>
                    <span className="truncate">{st.name}</span>
                  </button>
                );
              })}
            </div>
            {states.length > 0 && <p className="text-xs text-slate-500 mt-2">{states.length} chosen</p>}
          </section>
        )}

        {error && <div className="mb-5 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>}

        <button
          type="button"
          onClick={finish}
          disabled={saving}
          className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50"
        >
          {saving ? 'Setting up...' : 'Continue: upload your first contract'}
        </button>
        <p className="text-xs text-slate-500 mt-3">Your first 30 days are free. No card needed.</p>
      </main>
    </div>
  );
}
