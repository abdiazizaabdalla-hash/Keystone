'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

interface ClientLink {
  id: string;
  client_name: string | null;
  client_email: string | null;
  client_note: string | null;
  token: string;
  expires_at: string;
  revoked_at: string | null;
  last_accessed_at: string | null;
  access_count: number;
  created_at: string;
}

interface StepOption {
  id: string;
  name: string;
}

// The agent portal's "Share with your client" card: the agent adds their
// buyer or seller (name + email), picks which checklist steps the client
// can see, and the client gets an email with a live progress page. No
// account or password for the client. Mirrors the TC's own "Agent portal
// access" invite card, one level down. Backed by
// /api/agent/transactions/[id]/clients.
export default function ClientShareCard({
  transactionId,
  steps,
  documents,
  onDocumentsShared,
  contacts,
}: {
  transactionId: string;
  steps: StepOption[];
  documents: { id: string; name: string; clientVisible: boolean }[];
  onDocumentsShared: (ids: string[]) => void;
  /** This deal's contacts; the agent can pick a client from here instead of typing them. */
  contacts: { id: string; name: string | null; email: string | null; role: string | null }[];
}) {
  const router = useRouter();
  const [links, setLinks] = useState<ClientLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [pickedDocIds, setPickedDocIds] = useState<string[]>([]);
  const [autoShare, setAutoShare] = useState(false); // saved setting
  const [pickedAutoShare, setPickedAutoShare] = useState(false); // in the open form
  const [sending, setSending] = useState(false);

  const [editingSteps, setEditingSteps] = useState(false);
  const [savingSteps, setSavingSteps] = useState(false);

  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const base = `/api/agent/transactions/${transactionId}/clients`;

  useEffect(() => {
    let cancelled = false;
    authFetch(base)
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setLinks(Array.isArray(data.links) ? data.links : []);
        setVisibleIds(Array.isArray(data.visibleTaskIds) ? data.visibleTaskIds : []);
        setAutoShare(data.shareNewDocuments === true);
      })
      .catch((err) => {
        if (err instanceof AuthRequiredError) router.push('/agent/login');
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [base, router]);

  const defaultPicked = () => (visibleIds.length > 0 ? visibleIds : steps.map((s) => s.id));

  // Contacts with an email who don't already have an active link. Buyers and sellers first.
  const takenEmails = new Set(links.filter((l) => !l.revoked_at && new Date(l.expires_at) >= new Date()).map((l) => (l.client_email || '').toLowerCase()));
  const roleRank = (role: string | null) => (/buyer|seller|client/i.test(role || '') ? 0 : 1);
  const contactChoices = contacts
    .filter((c) => c.email && !takenEmails.has(c.email.toLowerCase()))
    .sort((a, b) => roleRank(a.role) - roleRank(b.role));

  const sharedDocIds = documents.filter((d) => d.clientVisible).map((d) => d.id);

  const openForm = () => {
    setPickedIds(defaultPicked());
    setPickedDocIds(sharedDocIds);
    setPickedAutoShare(autoShare);
    setShowForm(true);
    setMessage('');
  };

  const toggle = (id: string) =>
    setPickedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const stepPicker = (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">Steps your client can see</p>
        <div className="flex gap-3">
          <button type="button" onClick={() => setPickedIds(steps.map((s) => s.id))} className="text-xs text-blue-400 hover:text-blue-300">
            Select all
          </button>
          <button type="button" onClick={() => setPickedIds([])} className="text-xs text-slate-400 hover:text-slate-300">
            None
          </button>
        </div>
      </div>
      <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
        {steps.map((s) => (
          <label key={s.id} className="flex items-start gap-2 text-sm text-slate-200 cursor-pointer">
            <input type="checkbox" checked={pickedIds.includes(s.id)} onChange={() => toggle(s.id)} className="mt-1" />
            <span>{s.name}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const toggleDoc = (id: string) =>
    setPickedDocIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Documents are opt-in: nothing is shown to the client until it is ticked here.
  const docPicker = (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm text-blue-200 cursor-pointer">
        <input type="checkbox" checked={pickedAutoShare} onChange={(e) => setPickedAutoShare(e.target.checked)} className="mt-1" />
        <span>
          Share new documents added to this deal from now on
          <span className="block text-[11px] text-slate-500">
            Covers uploads by you and your TC to Documents. Files attached in messages stay private unless you tick them.
          </span>
        </span>
      </label>
      {documents.length === 0 ? (
        <p className="text-xs text-slate-500">No documents on this deal yet.</p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">Documents your client can open now</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setPickedDocIds(documents.map((d) => d.id))} className="text-xs text-blue-400 hover:text-blue-300">
                Select all
              </button>
              <button type="button" onClick={() => setPickedDocIds([])} className="text-xs text-slate-400 hover:text-slate-300">
                None
              </button>
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
            {documents.map((d) => (
              <label key={d.id} className="flex items-start gap-2 text-sm text-slate-200 cursor-pointer">
                <input type="checkbox" checked={pickedDocIds.includes(d.id)} onChange={() => toggleDoc(d.id)} className="mt-1" />
                <span className="break-all">{d.name}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );

  const handleError = (err: unknown, fallback: string) => {
    if (err instanceof AuthRequiredError) {
      router.push('/agent/login');
      return;
    }
    setMessage(err instanceof Error ? err.message : fallback);
  };

  const handleShare = async () => {
    setMessage('');
    if (!name.trim() && !email.trim()) {
      setMessage('Add your client’s name or email.');
      return;
    }
    try {
      setSending(true);
      const res = await authFetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: name.trim() || undefined,
          clientEmail: email.trim() || undefined,
          note: note.trim() || undefined,
          visibleTaskIds: pickedIds,
          visibleDocumentIds: pickedDocIds,
          shareNewDocuments: pickedAutoShare,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to share');
      onDocumentsShared(pickedDocIds);
      setAutoShare(pickedAutoShare);
      setLinks((prev) => [data.link, ...prev]);
      setVisibleIds(pickedIds);
      setShowForm(false);
      setName('');
      setEmail('');
      setNote('');
      setMessage(
        !data.link.client_email
          ? 'Link created. Copy it below and send it to your client.'
          : data.emailSent
            ? `Sent to ${data.link.client_email}.`
            : 'Link created, but the email could not be sent. Copy the link below and send it yourself.'
      );
    } catch (err) {
      handleError(err, 'Failed to share');
    } finally {
      setSending(false);
    }
  };

  const handleSaveSteps = async () => {
    try {
      setSavingSteps(true);
      setMessage('');
      const res = await authFetch(base, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibleTaskIds: pickedIds, visibleDocumentIds: pickedDocIds, shareNewDocuments: pickedAutoShare }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save steps');
      setVisibleIds(pickedIds);
      onDocumentsShared(pickedDocIds);
      setAutoShare(pickedAutoShare);
      setEditingSteps(false);
      setMessage('Saved. Every client link now shows these steps and documents.');
    } catch (err) {
      handleError(err, 'Failed to save steps');
    } finally {
      setSavingSteps(false);
    }
  };

  const handleResend = async (link: ClientLink) => {
    try {
      setBusyId(link.id);
      setMessage('');
      const res = await authFetch(`${base}/${link.id}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to resend');
      setMessage(`Sent again to ${link.client_email}.`);
    } catch (err) {
      handleError(err, 'Failed to resend');
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = async (link: ClientLink) => {
    if (!confirm('Turn off this link? Your client will no longer be able to open it.')) return;
    try {
      setBusyId(link.id);
      setMessage('');
      const res = await authFetch(`${base}/${link.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to turn off link');
      setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, revoked_at: new Date().toISOString() } : l)));
    } catch (err) {
      handleError(err, 'Failed to turn off link');
    } finally {
      setBusyId(null);
    }
  };

  const handleCopy = async (link: ClientLink) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/external/${link.token}`);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((prev) => (prev === link.id ? null : prev)), 2000);
    } catch {
      setMessage('Could not copy. Select the link and copy it manually.');
    }
  };

  const activeLinks = links.filter((l) => !l.revoked_at && new Date(l.expires_at) >= new Date());
  const inactiveLinks = links.filter((l) => !activeLinks.includes(l));

  // Same status-line look as the TC side's agent portal access: a coloured
  // dot, a short label, and an underlined action.
  const statusFor = (link: ClientLink) => {
    if (link.revoked_at) return { dot: 'bg-slate-500', text: 'text-slate-400', label: 'Link turned off' };
    if (new Date(link.expires_at) < new Date()) return { dot: 'bg-slate-500', text: 'text-slate-400', label: 'Link expired' };
    if (link.access_count > 0) {
      return {
        dot: 'bg-green-500',
        text: 'text-green-300',
        label: `Has viewed progress${link.access_count > 1 ? ` (${link.access_count}×)` : ''}`,
      };
    }
    return { dot: 'bg-amber-400', text: 'text-amber-300', label: link.client_email ? 'Sent, not opened yet' : 'Link created, not opened yet' };
  };

  const linkButton = 'text-blue-400 hover:text-blue-300 underline underline-offset-2 disabled:opacity-60';

  return (
    <div className="pt-6 mt-6 border-t border-slate-600" data-testid="client-access">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Client Access</p>
        <button
          type="button"
          onClick={() => (showForm ? setShowForm(false) : openForm())}
          className="text-xs text-blue-400 hover:text-blue-300 transition whitespace-nowrap shrink-0"
        >
          {showForm ? 'Cancel' : '+ Add client'}
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Give your buyer or seller a live progress page. They get an email, no account needed, and it updates as your TC completes each step.
      </p>

      {!loaded && <p className="text-xs text-slate-500">Checking client access…</p>}

      {loaded && activeLinks.length === 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="w-2 h-2 rounded-full shrink-0 bg-red-400" />
          <span className="font-medium text-red-300">No client access yet</span>
          {!showForm && (
            <button type="button" onClick={openForm} className={linkButton}>
              Invite now
            </button>
          )}
        </div>
      )}

      <div className="space-y-2.5">
        {activeLinks.map((link) => {
          const state = statusFor(link);
          return (
            <div key={link.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className={`w-2 h-2 rounded-full shrink-0 ${state.dot}`} />
              <span className="text-slate-100 font-medium">{link.client_name || link.client_email}</span>
              {link.client_name && link.client_email && <span className="text-slate-500">{link.client_email}</span>}
              <span className={`font-medium ${state.text}`}>{state.label}</span>
              {link.access_count > 0 && link.last_accessed_at && (
                <span className="text-slate-500">last {new Date(link.last_accessed_at).toLocaleDateString()}</span>
              )}
              <button type="button" onClick={() => handleCopy(link)} className={linkButton}>
                {copiedId === link.id ? 'Copied!' : 'Copy link'}
              </button>
              {link.client_email && (
                <button type="button" onClick={() => handleResend(link)} disabled={busyId === link.id} className={linkButton}>
                  {busyId === link.id ? 'Sending…' : 'Resend'}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleRevoke(link)}
                disabled={busyId === link.id}
                className="text-red-400 hover:text-red-300 underline underline-offset-2 disabled:opacity-60"
              >
                Turn off
              </button>
            </div>
          );
        })}
        {inactiveLinks.map((link) => {
          const state = statusFor(link);
          return (
            <div key={link.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className={`w-2 h-2 rounded-full shrink-0 ${state.dot}`} />
              <span className="text-slate-400">{link.client_name || link.client_email}</span>
              <span className={`font-medium ${state.text}`}>{state.label}</span>
            </div>
          );
        })}
      </div>

      {message && <p className="text-xs text-slate-300 mt-3">{message}</p>}

      {showForm && (
        <div className="bg-slate-800/50 border border-slate-600 rounded-lg p-4 mt-4 space-y-3">
          {contactChoices.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const picked = contactChoices.find((c) => c.id === e.target.value);
                if (picked) {
                  setName(picked.name || '');
                  setEmail(picked.email || '');
                }
              }}
              aria-label="Choose a client from this deal's contacts"
              className="w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Choose from this deal&apos;s contacts…</option>
              {contactChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.email}
                  {c.role ? ` · ${c.role}` : ''}
                  {c.name && c.email ? ` · ${c.email}` : ''}
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Client name"
            maxLength={100}
            className="w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.replace(/\s/g, ''))}
            placeholder="Client email (we'll send them the link)"
            className="w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="A short note to include, optional"
            maxLength={1000}
            rows={2}
            className="w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          {stepPicker}
          {docPicker}
          <button
            type="button"
            onClick={handleShare}
            disabled={sending}
            className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
          >
            {sending ? 'Sending…' : email.trim() ? 'Send progress link' : 'Create link'}
          </button>
          {!email.trim() && <p className="text-[11px] text-slate-500">No email? We&apos;ll just create the link so you can send it yourself.</p>}
        </div>
      )}

      {activeLinks.length > 0 && (
        <div className="mt-3 text-xs">
          {editingSteps ? (
            <div className="space-y-3 bg-slate-800/50 border border-slate-600 rounded-lg p-4">
              {stepPicker}
              {docPicker}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleSaveSteps}
                  disabled={savingSteps}
                  className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
                >
                  {savingSteps ? 'Saving…' : 'Save steps'}
                </button>
                <button type="button" onClick={() => setEditingSteps(false)} className="text-xs text-slate-400 hover:text-slate-300">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setPickedIds(defaultPicked());
                setPickedDocIds(sharedDocIds);
                setPickedAutoShare(autoShare);
                setEditingSteps(true);
              }}
              className={linkButton}
            >
              Edit what they see: {visibleIds.length} of {steps.length} steps, {sharedDocIds.length} document{sharedDocIds.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
