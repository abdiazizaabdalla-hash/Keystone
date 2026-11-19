'use client';

import { useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authClient';

// The brokerage owner's one-click snapshot of every agent and the stage of each file, as a CSV (for a spreadsheet) or a PDF (to print or file).
export default function ComplianceReportMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const download = async (format: 'csv' | 'pdf') => {
    setBusy(format);
    setError('');
    try {
      const res = await authFetch(`/api/oversight/compliance-report?format=${format}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not build the report');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `compliance-report-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the report');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative" ref={box}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="px-3.5 py-2 rounded-xl text-sm font-semibold border border-white/15 hover:border-white/30 text-slate-200 transition inline-flex items-center gap-2">
        Export compliance report <span aria-hidden className="text-slate-400"><svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 fill-current"><path d="M5.5 7.5 10 12l4.5-4.5 1 1L10 14 4.5 8.5z" /></svg></span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-72 z-30 bg-slate-800 border border-white/10 rounded-xl shadow-xl p-2">
          <p className="px-3 pt-1 pb-2 text-[11px] text-slate-400">Where every agent stands and what stage each file is in: checklist progress, late steps, missing required documents and file review.</p>
          <button type="button" role="menuitem" disabled={busy !== null} onClick={() => download('pdf')} className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-100 hover:bg-white/10 disabled:opacity-50">{busy === 'pdf' ? 'Building PDF…' : 'Download as PDF'}<span className="block text-[11px] text-slate-400">To print or keep on file</span></button>
          <button type="button" role="menuitem" disabled={busy !== null} onClick={() => download('csv')} className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-100 hover:bg-white/10 disabled:opacity-50">{busy === 'csv' ? 'Building CSV…' : 'Download as CSV'}<span className="block text-[11px] text-slate-400">For a spreadsheet</span></button>
          {error && <p className="px-3 py-1.5 text-xs text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
}
