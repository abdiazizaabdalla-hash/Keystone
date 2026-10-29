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
export default function ClientShareCard({ transactionId, steps }: { transactionId: string; steps: StepOption[] }) {
  const router = useRouter();
  const [links, setLinks] = useState<ClientLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [pickedIds, setPickedIds] = useState<string[]>([]);
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

  const openForm = () => {
    setPickedIds(defaultPicked());
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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to share');
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
        body: JSON.stringify({ visibleTaskIds: pickedIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save steps');
      setVisibleIds(pickedIds);
      setEditingSteps(false);
      setMessage('Saved. Every client link now shows these steps.');
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

  return (
    <section className="bg-white/5 border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-slate-100">Share with your client</h2>
        <button
          type="button"
          onClick={() => (showForm ? setShowForm(false) : openForm())}
          className="text-sm text-blue-400 hover:text-blue-300 font-medium transition"
        >
          {showForm ? 'Cancel' : '+ Add client'}
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Give your buyer or seller a live progress page. They get an email, no account needed, and it updates as your TC completes each step.
      </p>

      {showForm && (
        <div className="bg-slate-800/50 border border-slate-600 rounded-lg p-4 mb-4 space-y-3">
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

      {message && <p className="text-xs text-slate-300 mb-3">{message}</p>}

      {loaded && links.length === 0 && !showForm && (
        <p className="text-sm text-slate-500 italic">Nobody has been given a link yet.</p>
      )}

      <div className="space-y-2">
        {links.map((link) => {
          const expired = new Date(link.expires_at) < new Date();
          const revoked = Boolean(link.revoked_at);
          const live = !expired && !revoked;
          return (
            <div key={link.id} className="bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-slate-100 font-medium truncate">{link.client_name || link.client_email}</p>
                  {link.client_name && link.client_email && <p className="text-xs text-slate-400 truncate">{link.client_email}</p>}
                </div>
                <span
                  className={`flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    live
                      ? 'bg-green-500/20 border border-green-500/50 text-green-300'
                      : 'bg-slate-600/40 border border-slate-500/50 text-slate-400'
                  }`}
                >
                  {revoked ? 'Turned off' : expired ? 'Expired' : 'Active'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {link.access_count > 0
                  ? `Opened ${link.access_count} time${link.access_count === 1 ? '' : 's'}${
                      link.last_accessed_at ? `, last ${new Date(link.last_accessed_at).toLocaleDateString()}` : ''
                    }`
                  : 'Not opened yet'}
              </p>
              {live && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                  <button type="button" onClick={() => handleCopy(link)} className="text-xs text-blue-400 hover:text-blue-300 font-medium transition">
                    {copiedId === link.id ? 'Copied!' : 'Copy link'}
                  </button>
                  {link.client_email && (
                    <button
                      type="button"
                      onClick={() => handleResend(link)}
                      disabled={busyId === link.id}
                      className="text-xs text-blue-400 hover:text-blue-300 font-medium transition disabled:opacity-50"
                    >
                      Resend email
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRevoke(link)}
                    disabled={busyId === link.id}
                    className="text-xs text-red-400 hover:text-red-300 font-medium transition disabled:opacity-50"
                  >
                    Turn off
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {links.some((l) => !l.revoked_at && new Date(l.expires_at) >= new Date()) && (
        <div className="mt-4 pt-4 border-t border-slate-700">
          {editingSteps ? (
            <div className="space-y-3">
              {stepPicker}
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
                setEditingSteps(true);
              }}
              className="text-xs text-slate-300 hover:text-white font-medium transition"
            >
              Edit steps shown ({visibleIds.length} of {steps.length})
            </button>
          )}
        </div>
      )}
    </section>
  );
}
