'use client';

import { useState } from 'react';
import { authFetch } from '@/lib/authClient';
import SignatureFieldPlacer from '@/components/SignatureFieldPlacer';
import { FIELD_LABEL, MAX_SIGNERS, type SigningField } from '@/lib/signingFields';

export interface ListingSigningRequest {
  id: string;
  listing_document_id: string | null;
  signed_listing_document_id: string | null;
  signer_name: string;
  signer_email: string;
  status: string;
  signing_order: number;
  group_id: string | null;
  signed_at: string | null;
  decline_reason: string | null;
  created_at: string;
}

interface Props {
  doc: { id: string; file_name: string; url: string | null };
  /** Pre-fills the first signer (usually the seller). */
  seller: { name: string | null; email: string | null };
  /** People on the listing who can receive the signed copy. */
  people: { name: string | null; email: string | null; role: string | null }[];
  onClose: () => void;
  onSent: () => void;
}

const inputCls =
  'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SUBJECT = 'Signed: {{document}} - {{property}}';
const DEFAULT_MESSAGE =
  'Hi {{recipient_name}},\n\nAttached is the signed copy of {{document}} for {{property}}, signed by {{signer}} on {{signed_date}}.\n\nPlease let me know if you need anything else.';

// Sends one listing document (a PDF) for e-signature: who signs and in what order, where they sign, and who gets the
// signed copy. Uses the same signing flow as deals.
export default function ListingSignModal({ doc, seller, people, onClose, onSent }: Props) {
  const [signers, setSigners] = useState<{ name: string; email: string }[]>([{ name: seller.name || '', email: seller.email || '' }]);
  const [fields, setFields] = useState<SigningField[]>([]);
  const [placerOpen, setPlacerOpen] = useState(false);
  const [copyOn, setCopyOn] = useState(false);
  const [recipients, setRecipients] = useState<{ name: string; email: string; title: string }[]>([]);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setError('');
    const bad = signers.findIndex((s) => !s.name.trim() || !EMAIL_RE.test(s.email.trim()));
    if (bad >= 0) {
      setError(`Enter a name and a valid email for ${signers.length > 1 ? `signer ${bad + 1}` : 'the signer'}.`);
      return;
    }
    const copyList = copyOn ? recipients.filter((r) => r.email.trim()) : [];
    if (copyOn && copyList.length === 0) {
      setError('Add at least one email for the signed copy, or untick that option.');
      return;
    }
    if (copyList.some((r) => !EMAIL_RE.test(r.email.trim()))) {
      setError('One of the signed-copy emails is not valid.');
      return;
    }
    setSending(true);
    try {
      const res = await authFetch('/api/signing-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingDocumentId: doc.id,
          signers: signers.map((s) => ({ name: s.name.trim(), email: s.email.trim() })),
          ...(fields.length > 0 ? { fields } : {}),
          ...(copyList.length > 0 ? { sendCopyTo: copyList, copySubject: subject, copyMessage: message } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not send for signature');
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send for signature');
    } finally {
      setSending(false);
    }
  };

  const quickPicks = people.filter((p) => p.email && EMAIL_RE.test(p.email));
  const selected = new Set(recipients.map((r) => r.email.trim().toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label="Send for signature">
      <div className="w-full max-w-2xl bg-slate-800 border border-slate-600 rounded-lg p-5 md:p-6 my-8">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-bold text-slate-100">Send for signature</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-4 break-words">{doc.file_name}</p>

        <div className="space-y-2 mb-4">
          {signers.map((s, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-2 items-center">
              <input className={inputCls} placeholder={signers.length > 1 ? `Signer ${i + 1} name` : 'Signer name'} value={s.name} onChange={(e) => setSigners((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} maxLength={200} />
              <input className={inputCls} type="email" placeholder="Email" value={s.email} onChange={(e) => setSigners((p) => p.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} maxLength={320} />
              {signers.length > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSigners((p) => p.filter((_, j) => j !== i));
                    // Drop that signer's spots and shift later signers up one.
                    setFields((p) => p.filter((f) => f.signer !== i).map((f) => (f.signer > i ? { ...f, signer: f.signer - 1 } : f)));
                  }}
                  className="text-slate-500 hover:text-red-400 text-sm px-1"
                  title="Remove signer"
                >
                  ✕
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          {signers.length < MAX_SIGNERS && (
            <button type="button" onClick={() => setSigners((p) => [...p, { name: '', email: '' }])} className="text-xs text-blue-400 hover:text-blue-300">
              + Add another signer
            </button>
          )}
          {signers.length > 1 && <p className="text-xs text-slate-400">They sign in this order. Each person is emailed after the one before them finishes.</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs mb-4">
          <button
            type="button"
            onClick={() => setPlacerOpen(true)}
            disabled={!doc.url}
            className="px-3 py-1.5 border border-blue-500/60 text-blue-300 hover:bg-blue-500/10 disabled:opacity-50 rounded-lg transition"
          >
            {fields.length > 0 ? 'Edit signature spots' : 'Place signature spots'}
          </button>
          <span className="text-slate-400">
            {fields.length > 0
              ? (['signature', 'initials', 'date'] as const)
                  .map((t) => [t, fields.filter((f) => f.type === t).length] as const)
                  .filter(([, n]) => n > 0)
                  .map(([t, n]) => `${n} ${FIELD_LABEL[t].toLowerCase()}`)
                  .join(', ') + ' placed on the document'
              : 'Optional. Without spots, the signature goes on a certificate page at the end.'}
          </span>
        </div>
        {placerOpen && doc.url && (
          <SignatureFieldPlacer
            documentUrl={doc.url}
            fileName={doc.file_name}
            initialFields={fields}
            signers={signers.map((s) => ({ name: s.name }))}
            onSave={(next) => {
              setFields(next);
              setPlacerOpen(false);
            }}
            onCancel={() => setPlacerOpen(false)}
          />
        )}

        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer mb-2">
          <input type="checkbox" checked={copyOn} onChange={(e) => setCopyOn(e.target.checked)} className="accent-blue-500" />
          After it&apos;s signed, email the signed copy to others (agent, seller, attorney...)
        </label>
        {copyOn && (
          <div className="space-y-2 border-l-2 border-slate-600 pl-3 mb-4">
            {quickPicks.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {quickPicks.map((p) => {
                  const email = (p.email as string).trim();
                  const on = selected.has(email.toLowerCase());
                  return (
                    <button
                      key={email}
                      type="button"
                      onClick={() => setRecipients((prev) => (on ? prev.filter((r) => r.email.trim().toLowerCase() !== email.toLowerCase()) : [...prev, { name: p.name || '', email, title: p.role || '' }]))}
                      className={`text-xs px-2 py-1 rounded-full border transition ${on ? 'bg-blue-500/20 border-blue-500 text-blue-200' : 'bg-slate-700/60 border-slate-600 text-slate-300 hover:border-slate-400'}`}
                    >
                      {on ? '✓ ' : '+ '}
                      {p.role ? `${p.role}: ` : ''}
                      {p.name || email}
                    </button>
                  );
                })}
              </div>
            )}
            {recipients.map((r, i) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_1fr_auto] gap-2 items-center">
                <input className={inputCls} placeholder="Name" value={r.name} onChange={(e) => setRecipients((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className={inputCls} type="email" placeholder="Email" value={r.email} onChange={(e) => setRecipients((p) => p.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                <input className={inputCls} placeholder="Title (e.g. Agent)" value={r.title} onChange={(e) => setRecipients((p) => p.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <button type="button" onClick={() => setRecipients((p) => p.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400 text-sm px-1" title="Remove">
                  ✕
                </button>
              </div>
            ))}
            {recipients.length < 10 && (
              <button type="button" onClick={() => setRecipients((p) => [...p, { name: '', email: '', title: '' }])} className="text-xs text-blue-400 hover:text-blue-300">
                + Add someone else
              </button>
            )}
            <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" maxLength={200} />
            <textarea className={inputCls} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Email message" maxLength={3000} />
            <p className="text-xs text-slate-500">
              Fills in automatically: {'{{recipient_name}}'}, {'{{recipient_title}}'}, {'{{document}}'}, {'{{property}}'}, {'{{signer}}'}, {'{{signed_date}}'}. Max 10 people. Replies go to you.
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={send} disabled={sending} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
            {sending ? 'Sending…' : 'Send for signature'}
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-600 text-slate-300 hover:text-slate-100 text-sm rounded-lg">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
