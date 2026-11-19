'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { ADMIN_ROLES, roleLabel, type AdminRole } from '@/lib/brokerageAdmins';

// Managing accounts and administrators of the brokerage (Collaborate → Managing accounts, owner only): people who help run the brokerage
// with their own Relay login. A managing account runs it like the owner (not plan or billing); narrower roles are part of Brokerage Pro.

interface Person { id: string; email: string; role: AdminRole; signedIn: boolean }
interface Data { tier: 'basic' | 'pro'; limit: number; roles: AdminRole[]; admins: Person[]; ready: boolean }

export default function BrokerageAdmins() {
  const [data, setData] = useState<Data | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('managing');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await authFetch('/api/brokerage/admins');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not load administrators');
    setData(body);
    setRole((r) => (body.roles.includes(r) ? r : body.roles.includes('managing') ? 'managing' : body.roles[0]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load administrators')); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await authFetch('/api/brokerage/admins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not add');
      setEmail('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Person) => {
    if (!window.confirm(`Remove ${p.email}? Their access ends right away.`)) return;
    setBusy(true);
    setError('');
    try {
      const res = await authFetch(`/api/brokerage/admins?id=${p.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not remove');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <p className="text-sm text-red-300">{error}</p> : null;
  const full = data.admins.length >= data.limit;

  return (
    <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6 mb-6">
      <h2 className="font-display font-semibold text-slate-100 mb-1">Managing accounts</h2>
      <p className="text-sm text-slate-400 mb-4">
        Add another person to run the brokerage with you. A managing account has its own login and works like yours: the dashboard, agents, compliance, reports, automations and commissions. {data.tier === 'pro' ? `Up to ${data.limit} people. Choose a narrower role to limit what someone can do.` : 'Brokerage Basic includes one. Brokerage Pro adds up to five, with narrower roles such as Viewer.'}
        {' '}They never see your own workspace, and cannot change your plan or billing or add other managing accounts. To add an agent, use Invite on the Agents tab.
      </p>
      {error && <p className="text-sm text-red-300 mb-3">{error}</p>}
      {!data.ready && <p className="text-sm text-amber-300 mb-3">The database needs one more update before administrators work. Run add-brokerage-admins.sql, then add-brokerage-workflows.sql, in Supabase.</p>}

      {data.admins.length > 0 && (
        <ul className="divide-y divide-white/5 mb-4">
          {data.admins.map((p) => (
            <li key={p.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-100 truncate">{p.email}</p>
                <p className="text-xs text-slate-500">{roleLabel(p.role)} · {p.signedIn ? 'Has signed in' : 'Has not signed in yet'}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => remove(p)} className="text-xs text-red-300 hover:text-red-200">Remove</button>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="text-sm text-slate-400">You have used all {data.limit} person{data.limit === 1 ? '' : 's'} on your plan.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Their email" aria-label="Email of the person to add" className="flex-1 min-w-[12rem] bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2 text-slate-100 placeholder-slate-500 text-sm" />
            {data.roles.length > 1 && (
              <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} aria-label="Role" className="bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-slate-100 text-sm">
                {ADMIN_ROLES.filter((r) => data.roles.includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            )}
            <button type="button" disabled={busy || !email.trim()} onClick={add} className="px-5 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-semibold rounded-lg transition text-sm">Add person</button>
          </div>
          <p className="text-xs text-slate-500">{ADMIN_ROLES.find((r) => r.id === role)?.blurb} They sign in at the normal sign-in page with this email.</p>
        </div>
      )}
    </div>
  );
}
