'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';

// One popup for adding the other side to a deal or listing, from either end:
//   role "tc"    an agent adds their transaction coordinator (offers coordinators they invited before)
//   role "agent" a coordinator adds an agent (offers their agents and contacts, latest deals first)
// First question: do they already have a Relay TC account? Then pick them from the list; typing an email is the last resort.
// By default the modal sends the invitation itself; pass `onPick` to handle the chosen person yourself (e.g. set a listing's agent).

type Suggestion = { name: string; email: string; source: 'recent' | 'agent' | 'contact'; recent: boolean; agentId?: string };
export type PickedPerson = { name: string; email: string; agentId?: string; usesRelay: boolean };

export default function InvitePersonModal({
  role,
  transactionId,
  listingId,
  onClose,
  onInvited,
  onPick,
  excludeEmails = [],
  pickOnly = false,
}: {
  role: 'tc' | 'agent';
  transactionId?: string;
  listingId?: string;
  onClose: () => void;
  onInvited?: () => void;
  onPick?: (person: PickedPerson) => Promise<void>;
  /** People already on this deal or listing: shown but not selectable. */
  excludeEmails?: string[];
  /** Only choose the person (the invitation goes out later, e.g. when the deal is created): no account question. */
  pickOnly?: boolean;
}) {
  const [usesRelay, setUsesRelay] = useState<boolean | null>(pickOnly ? true : null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Suggestion | null>(null);
  const [manual, setManual] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [emailFailed, setEmailFailed] = useState(false);

  const who = role === 'tc' ? 'transaction coordinator' : 'agent';
  const noun = listingId ? 'listing' : 'deal';
  const taken = useMemo(() => new Set(excludeEmails.map((e) => e.trim().toLowerCase())), [excludeEmails]);

  useEffect(() => {
    if (usesRelay === null || suggestions) return;
    (async () => {
      try {
        const res = await authFetch(`/api/invite-suggestions?role=${role}`);
        const data = res.ok ? await res.json() : {};
        const list: Suggestion[] = Array.isArray(data.suggestions) ? data.suggestions : [];
        setSuggestions(list);
        if (list.length === 0) setManual(true);
      } catch {
        setSuggestions([]);
        setManual(true);
      }
    })();
  }, [usesRelay, suggestions, role]);

  const recent = (suggestions || []).filter((s) => s.recent).slice(0, 5);
  const filtered = (suggestions || []).filter((s) => {
    const q = query.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.email.includes(q);
  });

  const target = manual ? { name: name.trim() || email.trim(), email: email.trim(), agentId: undefined } : chosen ? { name: chosen.name, email: chosen.email, agentId: chosen.agentId } : null;

  const send = async () => {
    if (!target || !target.email.includes('@')) {
      setError(manual ? `Enter the ${who}’s email address.` : `Choose a ${who} from the list.`);
      return;
    }
    setSending(true);
    setError('');
    try {
      if (onPick) {
        await onPick({ name: target.name, email: target.email, agentId: target.agentId, usesRelay: usesRelay !== false });
      } else {
        const url = listingId ? `/api/listings/${listingId}/coordinator` : '/api/agent-invites';
        const body = listingId
          ? { email: target.email, usesRelay: usesRelay !== false }
          : { transactionId, email: target.email, ...(role === 'tc' ? { inviteeRole: 'tc' } : {}), usesRelay: usesRelay !== false };
        const res = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not send the invitation');
        setEmailFailed(data.inviteEmailSent === false);
      }
      setSentTo(target.email);
      onInvited?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitation');
    } finally {
      setSending(false);
    }
  };

  const choice = 'w-full text-left bg-slate-800/60 hover:bg-slate-800 border border-white/10 hover:border-blue-500/50 rounded-xl p-4 transition';
  const row = (s: Suggestion) => {
    const disabled = taken.has(s.email);
    const on = chosen?.email === s.email;
    return (
      <button
        key={s.email}
        type="button"
        disabled={disabled}
        onClick={() => { setChosen(s); setManual(false); setError(''); }}
        className={`w-full text-left rounded-lg px-3 py-2 border transition disabled:opacity-40 ${on ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 bg-slate-800/60 hover:bg-slate-800'}`}
      >
        <span className="block text-sm font-semibold text-slate-100">{s.name}{disabled ? ' · already added' : ''}</span>
        <span className="block text-xs text-slate-400">{s.email}{s.source === 'contact' ? ' · from your contacts' : ''}</span>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Add a ${who}`}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold text-slate-100">Add {role === 'tc' ? 'a transaction coordinator' : 'an agent'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-200">✕</button>
        </div>

        {sentTo ? (
          <div>
            {emailFailed ? (
              <p className="text-amber-300 mb-2" role="alert">The invitation for {sentTo} is saved, but the email could not be sent. Use Resend invitation on the {noun} page to try again.</p>
            ) : (
              <p className="text-slate-200 mb-2">{pickOnly ? `${sentTo} is added.` : `Invitation sent to ${sentTo}.`}</p>
            )}
            <p className="text-sm text-slate-400 mb-5">
              {pickOnly ? 'They are saved on your Agents list.' : role === 'tc'
                ? `Once they accept, the ${noun} appears in their list and you can message each other here.`
                : usesRelay === false
                  ? `They get a link to set up their free agent login. The ${noun} is on their portal as soon as they do.`
                  : `They can sign in with their Relay TC login and see the ${noun} on their portal.`}
            </p>
            <button type="button" onClick={onClose} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl">Done</button>
          </div>
        ) : usesRelay === null ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-300 mb-1">Does your {who} already use Relay TC?</p>
            <button type="button" className={choice} onClick={() => setUsesRelay(true)}>
              <p className="font-semibold text-slate-100 text-sm">Yes, they have an account</p>
              <p className="text-xs text-slate-400 mt-1">{role === 'tc' ? 'We email them to sign in and accept.' : 'We email them to sign in and see it.'}</p>
            </button>
            <button type="button" className={choice} onClick={() => setUsesRelay(false)}>
              <p className="font-semibold text-slate-100 text-sm">No, not yet</p>
              <p className="text-xs text-slate-400 mt-1">{role === 'tc' ? `We email them what Relay TC is and how to create an account to take this ${noun}.` : 'We set up a free agent login for them and email the link.'}</p>
            </button>
          </div>
        ) : (
          <div>
            {suggestions === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : (
              <>
                {recent.length > 0 && !manual && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{role === 'tc' ? 'Worked with recently' : 'On your latest deals'}</p>
                    <div className="space-y-1.5">{recent.map(row)}</div>
                  </div>
                )}
                {suggestions.length > recent.length && !manual && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{role === 'tc' ? 'Everyone you invited' : 'Your agents and contacts'}</p>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search by name or email"
                      className="w-full mb-2 bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none"
                    />
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">{filtered.filter((s) => !recent.includes(s)).map(row)}</div>
                  </div>
                )}
                {manual ? (
                  <div className="space-y-2">
                    <p className="text-sm text-slate-300">{suggestions.length === 0 ? `You have nobody saved yet. Enter their details once and they will be offered next time.` : `Their details`}</p>
                    {role === 'agent' && (
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none" />
                    )}
                    <input
                      type="email"
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !sending && send()}
                      placeholder={`${role === 'tc' ? 'coordinator' : 'agent'}@example.com`}
                      className="w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none"
                    />
                    {suggestions.length > 0 && <button type="button" onClick={() => setManual(false)} className="text-xs text-blue-300 hover:text-blue-200">Back to the list</button>}
                  </div>
                ) : (
                  <button type="button" onClick={() => { setManual(true); setChosen(null); }} className="text-xs text-blue-300 hover:text-blue-200">Not listed? Enter an email instead</button>
                )}
              </>
            )}
            {error && <p className="text-sm text-red-300 mt-2">{error}</p>}
            <div className="flex flex-wrap gap-2 mt-4">
              <button type="button" onClick={send} disabled={sending || !target?.email} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                {sending ? (pickOnly ? 'Adding…' : 'Sending…') : target?.name ? `${pickOnly ? 'Add' : 'Invite'} ${target.name}` : pickOnly ? 'Add' : 'Send invitation'}
              </button>
              {pickOnly ? (
                <button type="button" onClick={onClose} className="px-4 py-2 text-slate-300 hover:text-slate-100 text-sm rounded-xl">Cancel</button>
              ) : (
                <button type="button" onClick={() => { setUsesRelay(null); setError(''); }} className="px-4 py-2 text-slate-300 hover:text-slate-100 text-sm rounded-xl">Back</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
