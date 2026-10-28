'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import Link from 'next/link';
import TeamMessaging from '@/components/TeamMessaging';
import TeamContacts from '@/components/TeamContacts';
import type { ContactRow } from '@/lib/contactsCrm';

interface Member {
  userId: string;
  email: string;
  name: string;
  role: 'owner' | 'member';
  isYou: boolean;
}

interface PendingInvite {
  id: string;
  email: string;
  createdAt: string;
}

interface TeamInfo {
  id: string;
  name: string | null;
}

interface TeamResponse {
  team: TeamInfo | null;
  role: 'owner' | 'member' | null;
  planId: string | null;
  seatLimit: number;
  seatPriceLabel?: string;
  members: Member[];
  pendingInvites: PendingInvite[];
}

type Tab = 'overview' | 'messages' | 'contacts' | 'people' | 'settings';

export default function CollaboratePage() {
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>('overview');
  const [unread, setUnread] = useState(0);
  const [teamContacts, setTeamContacts] = useState<ContactRow[]>([]);

  const setTab = (next: Tab) => {
    setTabState(next);
    try {
      window.history.replaceState(null, '', `#${next}`);
    } catch {
      /* the tab still switches */
    }
  };

  // Open on the tab named in the link (/dashboard/collaborate#messages), and load the small counts the overview shows.
  useEffect(() => {
    const t = setTimeout(async () => {
      const wanted = window.location.hash.replace('#', '');
      if (['overview', 'messages', 'contacts', 'people', 'settings'].includes(wanted)) setTabState(wanted as Tab);
      try {
        const [sum, list] = await Promise.all([authFetch('/api/team/messages/summary'), authFetch('/api/contacts')]);
        if (sum.ok) setUnread((await sum.json()).total || 0);
        if (list.ok) {
          const rows = await list.json();
          setTeamContacts(Array.isArray(rows) ? rows.filter((c: ContactRow) => c.team_id) : []);
        }
      } catch {
        /* the overview works without these counts */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TeamResponse | null>(null);
  const [error, setError] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Team/brokerage settings: just the name.
  const [teamName, setTeamName] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');

  // Owner-only team compliance report: a CSV of where every team member's open files stand right now.
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [reportMessage, setReportMessage] = useState('');

  const handleDownloadReport = async () => {
    setDownloadingReport(true);
    setReportMessage('');
    try {
      const res = await authFetch('/api/team/compliance-export');
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Could not build the report');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `team-compliance-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setReportMessage('Downloaded.');
    } catch (err) {
      setReportMessage(err instanceof Error ? err.message : 'Could not build the report');
    } finally {
      setDownloadingReport(false);
    }
  };

  const load = async () => {
    try {
      const res = await authFetch('/api/team');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load team');
      setData(json);
      setTeamName(json.team?.name || '');
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Deferred so the initial fetch's setState is not a synchronous effect update.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteMessage('');
    try {
      const res = await authFetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to invite');
      const emailNote = json.emailSent === false ? ' (the notification email failed to send — let them know directly.)' : '';
      setInviteMessage(
        json.status === 'added'
          ? `${inviteEmail} was added to your team.${emailNote}`
          : `Invite sent to ${inviteEmail} — they'll join the team automatically when they sign up.${emailNote}`
      );
      setInviteEmail('');
      await load();
    } catch (err) {
      setInviteMessage(err instanceof Error ? err.message : 'Failed to invite');
    } finally {
      setInviting(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsMessage('');
    try {
      const payload: Record<string, unknown> = { name: teamName };
      const res = await authFetch('/api/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save settings');
      setSettingsMessage('Saved.');
      await load();
    } catch (err) {
      setSettingsMessage(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setRemovingId(userId);
    try {
      const res = await authFetch(`/api/team?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to remove teammate');
      // The backend already downgraded them off the Team plan and cut off
      // their access to this team's data before returning -- see DELETE
      // /api/team. This message just confirms that to the owner.
      setInviteMessage(
        json.emailSent === false
          ? 'Removed from your team and moved to the Starter plan (the notification email failed to send — let them know directly).'
          : "Removed from your team and moved to the Starter plan — they've been emailed."
      );
      await load();
    } catch (err) {
      setInviteMessage(err instanceof Error ? err.message : 'Failed to remove teammate');
    } finally {
      setRemovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 md:p-8">
        <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
      </div>
    );
  }

  if (!data || !data.team) {
    return (
      <div className="p-4 md:p-8">
        <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 mb-2">Collaborate</h1>
        <p className="text-slate-400">Collaborate is a Team/Brokerage plan feature. Upgrade to work with teammates.</p>
      </div>
    );
  }

  const isOwner = data.role === 'owner';
  const isBrokerage = data.planId === 'brokerage';
  const seatsUsed = data.members.length + data.pendingInvites.length;
  const teamLabel = data.team.name || (isBrokerage ? 'Your brokerage' : 'Your team');

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'messages', label: 'Messages', badge: unread },
    { id: 'contacts', label: 'Contacts', badge: undefined },
    { id: 'people', label: 'People' },
    ...(isOwner ? [{ id: 'settings' as Tab, label: 'Settings' }] : []),
  ];
  const activeTab: Tab = tab === 'settings' && !isOwner ? 'overview' : tab;
  const cardCls = 'bg-white/5 border border-white/10 rounded-2xl p-5';
  const initial = (m: Member) => ((m.name || m.email || '?')[0] || '?').toUpperCase();
  const recentShared = [...teamContacts].sort((a, b) => (b.shared_at || b.created_at).localeCompare(a.shared_at || a.created_at)).slice(0, 5);

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100">{teamLabel}</h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 capitalize">{data.role}</span>
      </div>
      <p className="text-slate-400 mb-6 max-w-3xl">
        Your team&rsquo;s home base. Each coordinator&rsquo;s deals, agents and contacts stay private to their own login; only contacts someone chooses to share appear here.
      </p>

      <div className="flex gap-1 border-b border-white/10 mb-6 overflow-x-auto" role="tablist" aria-label="Team sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setTab(t.id)}
            className={`relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition border-b-2 -mb-px ${
              activeTab === t.id ? 'border-blue-400 text-blue-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
            {!!t.badge && t.badge > 0 && <span className="ml-2 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500 text-white">{t.badge}</span>}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <button type="button" onClick={() => setTab('people')} className={`${cardCls} text-left hover:bg-white/10 transition`}>
              <p className="text-xs uppercase tracking-wider text-slate-500">Teammates</p>
              <p className="text-2xl font-semibold text-slate-100 mt-1">{data.members.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">{data.pendingInvites.length > 0 && isOwner ? `${data.pendingInvites.length} invite${data.pendingInvites.length === 1 ? '' : 's'} pending` : 'on this team'}</p>
            </button>
            <button type="button" onClick={() => setTab('messages')} className={`${cardCls} text-left hover:bg-white/10 transition`}>
              <p className="text-xs uppercase tracking-wider text-slate-500">Unread messages</p>
              <p className={`text-2xl font-semibold mt-1 ${unread > 0 ? 'text-blue-300' : 'text-slate-100'}`}>{unread}</p>
              <p className="text-xs text-slate-500 mt-0.5">team board and direct</p>
            </button>
            <button type="button" onClick={() => setTab('contacts')} className={`${cardCls} text-left hover:bg-white/10 transition`}>
              <p className="text-xs uppercase tracking-wider text-slate-500">Shared contacts</p>
              <p className="text-2xl font-semibold text-slate-100 mt-1">{teamContacts.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">visible to everyone</p>
            </button>
            {isOwner ? (
              <button type="button" onClick={() => setTab('people')} className={`${cardCls} text-left hover:bg-white/10 transition`}>
                <p className="text-xs uppercase tracking-wider text-slate-500">Seats</p>
                <p className="text-2xl font-semibold text-slate-100 mt-1">
                  {seatsUsed} / {data.seatLimit}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">used</p>
              </button>
            ) : (
              <div className={cardCls}>
                <p className="text-xs uppercase tracking-wider text-slate-500">Your role</p>
                <p className="text-2xl font-semibold text-slate-100 mt-1 capitalize">{data.role}</p>
                <p className="text-xs text-slate-500 mt-0.5">{isBrokerage ? 'brokerage' : 'team'} member</p>
              </div>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <section className={cardCls}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Team</h2>
                <button type="button" onClick={() => setTab('people')} className="text-xs text-blue-400 hover:text-blue-300">
                  {isOwner ? 'Manage' : 'See all'}
                </button>
              </div>
              <ul className="space-y-2">
                {data.members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-3">
                    <span className="w-8 h-8 shrink-0 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-sm font-bold text-white">{initial(m)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-100">
                      {m.name || m.email}
                      {m.isYou && <span className="text-xs text-slate-500"> (you)</span>}
                    </span>
                    <span className="text-xs text-slate-500 capitalize">{m.role}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className={cardCls}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Recently shared contacts</h2>
                <button type="button" onClick={() => setTab('contacts')} className="text-xs text-blue-400 hover:text-blue-300">
                  Open
                </button>
              </div>
              {recentShared.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing shared yet. Share the contacts your whole team works with, like preferred lenders and title companies.</p>
              ) : (
                <ul className="space-y-2">
                  {recentShared.map((c) => (
                    <li key={c.id} className="flex items-baseline justify-between gap-3">
                      <Link href={`/dashboard/contacts/${c.id}`} className="text-sm text-blue-400 hover:text-blue-300 truncate">
                        {c.name || c.email}
                      </Link>
                      <span className="text-xs text-slate-500 shrink-0">{c.is_mine === false ? c.shared_by_name || 'A teammate' : 'You'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setTab('messages')} className="px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">
              Open messages
            </button>
            {isOwner && (
              <>
                <button type="button" onClick={() => setTab('people')} className="px-4 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition">
                  Invite a teammate
                </button>
                <button type="button" onClick={() => setTab('settings')} className="px-4 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition">
                  Team report &amp; settings
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'messages' && <TeamMessaging members={data.members} isOwner={isOwner} />}

      {activeTab === 'contacts' && <TeamContacts onLoaded={setTeamContacts} />}

      {activeTab === 'people' && (
        <div className="max-w-4xl">
          <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-slate-600 flex items-center justify-between">
              <h2 className="font-display font-semibold text-slate-100">Team roster</h2>
              {isOwner && (
                <span className="text-xs text-slate-400">
                  {seatsUsed} / {data.seatLimit} seats used
                </span>
              )}
            </div>

            <div className="divide-y divide-slate-700">
              {data.members.map((member) => (
                <div key={member.userId} className="px-6 py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-100 font-medium truncate">{member.name || member.email}</span>
                      {member.isYou && <span className="text-xs text-slate-500">(you)</span>}
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${member.role === 'owner' ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-600 text-slate-300'}`}>{member.role}</span>
                    </div>
                    {member.name && <div className="text-xs text-slate-500 truncate">{member.email}</div>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {isOwner && !member.isYou && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(member.userId);
                        }}
                        disabled={removingId === member.userId}
                        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                      >
                        {removingId === member.userId ? 'Removing…' : 'Remove'}
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {isOwner &&
                data.pendingInvites.map((invite) => (
                  <div key={invite.id} className="px-6 py-4 flex items-center justify-between gap-4">
                    <div>
                      <span className="text-slate-300">{invite.email}</span>
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-600 text-slate-400">Invite pending</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {isOwner && (
            <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
              <h2 className="font-display font-semibold text-slate-100 mb-1">Invite a teammate</h2>
              {/* The backend (see POST /api/team) never hard-caps the team -- inviting past the currently-paid
                  seat count just adds one more prorated seat to the subscription automatically. The form always
                  stays available so that path is reachable; only the messaging changes. */}
              <p className="text-sm text-slate-400 mb-4">
                {seatsUsed < data.seatLimit
                  ? "They'll get the same plan access right away — no separate payment needed, it's covered by your subscription."
                  : `You're at your current seat count (${seatsUsed}/${data.seatLimit}). Inviting one more adds a prorated seat to your subscription (~${data.seatPriceLabel || '$30/mo'}) right away.`}
              </p>
              <form onSubmit={handleInvite} className="flex gap-3">
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  className="flex-1 bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <button type="submit" disabled={inviting} className="px-5 py-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50">
                  {inviting ? 'Inviting…' : 'Invite'}
                </button>
              </form>
              {inviteMessage && <p className="text-sm text-slate-300 mt-3">{inviteMessage}</p>}
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && isOwner && (
        <div className="max-w-4xl">
          <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6 mb-6">
            <h2 className="font-display font-semibold text-slate-100 mb-1">{isBrokerage ? 'Brokerage settings' : 'Team settings'}</h2>
            <p className="text-sm text-slate-400 mb-4">{isBrokerage ? 'Your brokerage name.' : "Your team's name."}</p>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{isBrokerage ? 'Brokerage name' : 'Team name'}</label>
                <input
                  type="text"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder={isBrokerage ? 'Acme Realty' : "Sarah's Team"}
                  className="w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <button type="submit" disabled={savingSettings} className="px-5 py-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50">
                {savingSettings ? 'Saving…' : 'Save'}
              </button>
              {settingsMessage && <p className="text-sm text-slate-300">{settingsMessage}</p>}
            </form>
          </div>

          <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
            <h2 className="font-display font-semibold text-slate-100 mb-1">Team compliance report</h2>
            <p className="text-sm text-slate-400 mb-4">
              A spreadsheet (CSV) of where every team member&rsquo;s open files stand right now: stage, checklist progress, closing date, next deadline and overdue deadlines. It is a status summary only &mdash; no prices,
              client names, documents, messages or contacts. Only the team owner can download it.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={handleDownloadReport} disabled={downloadingReport} className="px-5 py-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50">
                {downloadingReport ? 'Building…' : 'Download team report (CSV)'}
              </button>
              {reportMessage && <span className="text-sm text-slate-300">{reportMessage}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
