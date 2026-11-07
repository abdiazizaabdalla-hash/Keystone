'use client';

import { useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authClient';

/** Upload the logo that is printed at the top of every PDF you send: invoices, statements, compliance reports. */
export default function LogoSettingsCard() {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/settings/logo');
        if (res.ok) setUrl((await res.json()).url ?? null);
      } catch {
        // The card still works for uploading.
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await authFetch('/api/settings/logo', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save your logo');
      setUrl(data.url ?? null);
      setNote({ text: 'Saved. It now appears at the top of your PDFs.', bad: false });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : 'Could not save your logo', bad: true });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await authFetch('/api/settings/logo', { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not remove your logo');
      setUrl(null);
      setNote({ text: 'Logo removed.', bad: false });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : 'Could not remove your logo', bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8" data-testid="logo-settings">
      <h2 className="text-lg font-bold text-slate-100 mb-1">Your Logo</h2>
      <p className="text-sm text-slate-400 mb-6">
        Printed at the top of every PDF you send: invoices, commission statements and compliance reports. PNG or JPEG, up to 1 MB.
        A wide logo on a white or transparent background looks best.
      </p>
      <div className="flex flex-wrap items-center gap-5">
        <div className="h-20 w-56 rounded-xl bg-white flex items-center justify-center overflow-hidden border border-white/10">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Your logo" className="max-h-16 max-w-[13rem] object-contain" />
          ) : (
            <span className="text-xs text-slate-500">{loaded ? 'No logo yet' : 'Loading…'}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={input} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50">
            {busy ? 'Working…' : url ? 'Replace logo' : 'Upload logo'}
          </button>
          {url && (
            <button type="button" disabled={busy} onClick={() => void remove()} className="text-sm text-slate-300 hover:text-red-300 transition disabled:opacity-50">
              Remove
            </button>
          )}
        </div>
      </div>
      {note && <p className={`mt-4 text-sm ${note.bad ? 'text-red-300' : 'text-emerald-300'}`} role="status">{note.text}</p>}
    </div>
  );
}
