'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { useAutomationAccess } from '@/lib/useAutomationAccess';

// The Automation block in Settings. It shows on every coordinator account once automation is released:
//  - Pro and Team: the account-wide on/off switch (the pause switch: while off, nothing automatic runs and nothing waiting can be
//    approved) and a link to build and customise automations;
//  - Starter: a plain note that automation is part of Pro and Team. Nothing else about automation is shown to Starter.
export default function AutomationSettingsCard() {
  const { flagOn, allowed, ready } = useAutomationAccess();
  const [paused, setPaused] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!flagOn || !allowed) return;
    let live = true;
    authFetch('/api/automation/pause')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => live && setPaused(data ? data.paused === true : null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [flagOn, allowed]);

  if (!flagOn || !ready) return null;

  async function setPause(next: boolean) {
    setSaving(true);
    setMessage('');
    try {
      const res = await authFetch('/api/automation/pause', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: next }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not change the setting');
      setPaused(data.paused === true);
      setMessage(data.paused ? 'Automation is off. Nothing automatic will run until you turn it back on.' : 'Automation is on.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not change the setting');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id="automation" className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8 scroll-mt-6">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-lg font-bold text-slate-100">Automation</h2>
        <span className="inline-block px-2.5 py-1 bg-blue-500/20 border border-blue-500/50 text-blue-300 text-xs font-semibold rounded-full shrink-0">Pro / Team</span>
      </div>

      {!allowed ? (
        <>
          <p className="text-sm text-slate-400 mb-4">Follow-ups, reminders and drafted emails that run from your deal steps, with nothing sent until you approve it.</p>
          <p className="text-sm text-slate-200 mb-4">Upgrade to Pro/Team to use this feature.</p>
          <Link href="/dashboard/account" className="inline-block px-5 py-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition text-sm">
            See plans
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-400 mb-5">
            Automation follows up on your deals from the steps you set. Each deal has its own setting (off, draft for your approval, or automatic). This switch turns everything off at once, for every deal.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-3 mb-4">
            <div>
              <p className="text-sm font-semibold text-slate-100">{paused === null ? 'Checking...' : paused ? 'Automation is off' : 'Automation is on'}</p>
              <p className="text-xs text-slate-400">{paused ? 'Nothing automatic runs, and nothing waiting can be approved.' : 'Reminders and drafts run as set on each deal.'}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={paused === false}
              aria-label="Automation"
              disabled={saving || paused === null}
              onClick={() => void setPause(!paused)}
              className={`relative w-12 h-7 rounded-full transition disabled:opacity-50 ${paused === false ? 'bg-blue-500' : 'bg-slate-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition-transform ${paused === false ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          {message && <p className="text-sm text-slate-300 mb-4">{message}</p>}
          <Link href="/dashboard/automations" className="inline-block px-5 py-2 border border-slate-500 hover:border-blue-400 text-slate-100 font-semibold rounded-lg transition text-sm">
            Customize automations
          </Link>
        </>
      )}
    </div>
  );
}
