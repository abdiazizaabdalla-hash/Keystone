'use client';

import { useState } from 'react';
import PhoneInput from '@/components/PhoneInput';
import { authFetch } from '@/lib/authClient';
import type { ContactRow } from '@/lib/contactsCrm';

const inputCls =
  'w-full bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

// Add or edit a contact. Used on the Contacts list and the contact profile page.
export default function ContactEditModal({
  contact,
  organizations,
  onClose,
  onSaved,
  onAuthError,
  defaults,
}: {
  /** null to add a new contact */
  contact: ContactRow | null;
  /** organization contacts a person can be linked to */
  organizations: ContactRow[];
  onClose: () => void;
  onSaved: (saved: ContactRow) => void;
  onAuthError?: (err: unknown) => boolean;
  /** starting values for a new contact, for example the organization they are being added to */
  defaults?: { organizationId?: string; company?: string };
}) {
  const [form, setForm] = useState({
    contactType: (contact?.contact_type === 'organization' ? 'organization' : 'person') as 'person' | 'organization',
    name: contact?.name || '',
    email: contact?.email || '',
    phone: contact?.phone || '',
    company: contact?.company || defaults?.company || '',
    organizationId: contact?.organization_id || defaults?.organizationId || '',
    role: contact?.role || '',
    notes: contact?.notes || '',
    tags: (contact?.tags || []).join(', '),
    newsletter: contact?.newsletter || false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isOrg = form.contactType === 'organization';
  const orgChoices = organizations.filter((o) => o.id !== contact?.id);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await authFetch(contact ? `/api/contacts/${contact.id}` : '/api/contacts', {
        method: contact ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, organizationId: isOrg ? null : form.organizationId || null, tags: form.tags.split(',') }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save contact');
      onSaved(data);
    } catch (err) {
      if (onAuthError?.(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <form onSubmit={save} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-800 border border-slate-600 rounded-xl p-6 space-y-3">
        <h2 className="text-lg font-bold text-slate-100">{contact ? 'Edit contact' : 'Add contact'}</h2>
        <div className="inline-flex rounded-lg border border-slate-600 overflow-hidden text-sm" role="group" aria-label="Contact type">
          {(['person', 'organization'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setForm({ ...form, contactType: t })}
              className={`px-4 py-1.5 transition ${form.contactType === t ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
            >
              {t === 'person' ? 'Person' : 'Organization'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className={inputCls} placeholder={isOrg ? 'Organization name' : 'Name'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inputCls} placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <PhoneInput className={inputCls} placeholder="Phone" value={form.phone} onValueChange={(v) => setForm({ ...form, phone: v })} />
          {isOrg ? (
            <input className={inputCls} placeholder="Type (Brokerage, Title company, Lender…)" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          ) : (
            <input className={inputCls} placeholder="Role (Agent, Lender, Title…)" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          )}
          {!isOrg && (
            <>
              <select
                className={inputCls}
                value={form.organizationId}
                onChange={(e) => {
                  const org = orgChoices.find((o) => o.id === e.target.value);
                  setForm({ ...form, organizationId: e.target.value, company: org && !form.company ? org.name : form.company });
                }}
                aria-label="Works at"
              >
                <option value="">Works at… (optional)</option>
                {orgChoices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name || o.email}
                  </option>
                ))}
              </select>
              <input className={inputCls} placeholder="Company (free text)" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </>
          )}
          <input className={`${inputCls} sm:col-span-2`} placeholder="Tags, separated by commas" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        </div>
        <textarea
          className={inputCls}
          rows={3}
          maxLength={2000}
          placeholder="Preferences and context (communication style, what they care about…)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.newsletter}
            disabled={!form.email.trim()}
            onChange={(e) => setForm({ ...form, newsletter: e.target.checked })}
            className="accent-blue-500"
          />
          Agreed to receive my newsletter {!form.email.trim() && <span className="text-slate-500">(needs an email)</span>}
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={saving} className="px-5 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
