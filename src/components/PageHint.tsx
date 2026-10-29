'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { findTarget, placeTip, type Box } from '@/components/FirstRunGuide';

/**
 * One-time pointers the first time someone opens a page: Contacts (Import CSV)
 * and Invoices (QuickBooks). Each shows once per account (stored in
 * user_metadata.seen_hints via PATCH /api/auth/me) and is dismissible. The
 * highlight never blocks clicks. While a tutorial is running, the tutorial
 * covers the same ground itself, so these stay quiet.
 */

interface Hint {
  id: string;
  path: RegExp;
  target: string;
  title: string;
  body: string;
  link?: { label: string; href: string };
}

const HINTS: Hint[] = [
  {
    id: 'contacts',
    path: /^\/dashboard\/contacts\/?$/,
    target: 'contacts-import',
    title: 'Bring in your contacts',
    body: 'Have a list somewhere else? Click Import CSV to bring it in. Relay flags duplicates, and you can undo an import for two minutes.',
  },
  {
    id: 'invoices',
    path: /^\/dashboard\/invoices\/?$/,
    target: 'invoices-quickbooks',
    title: 'Use QuickBooks?',
    body: 'Connect QuickBooks in Settings and every invoice you create here is created there too, with payments recorded. This button imports and exports files if you prefer.',
    link: { label: 'Connect QuickBooks in Settings', href: '/dashboard/settings' },
  },
];

export default function PageHint({
  seen,
  suspended,
  onSeen,
}: {
  seen: string[];
  /** True while a tutorial is on screen. */
  suspended: boolean;
  onSeen: (id: string) => void;
}) {
  const pathname = usePathname();
  const hint = suspended ? null : HINTS.find((h) => h.path.test(pathname) && !seen.includes(h.id)) ?? null;
  const [box, setBox] = useState<Box | null>(null);
  const [tipH, setTipH] = useState(190);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const scrolled = useRef<string | null>(null);

  useEffect(() => {
    if (!hint) return;
    const tick = () => {
      const el = findTarget(hint.target);
      if (!el) {
        setBox(null);
        return;
      }
      if (scrolled.current !== hint.id) {
        scrolled.current = hint.id;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      const r = el.getBoundingClientRect();
      setBox((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height }
      );
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [hint]);

  // Using the highlighted control counts as having seen the hint.
  useEffect(() => {
    if (!hint) return;
    const onClick = (e: MouseEvent) => {
      const el = findTarget(hint.target);
      if (el && e.target instanceof Node && el.contains(e.target)) onSeen(hint.id);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [hint, onSeen]);

  useEffect(() => {
    const h = tipRef.current?.offsetHeight;
    if (h && Math.abs(h - tipH) > 2) setTipH(h);
  }, [tipH, hint, box]);

  if (!hint || !box) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const narrow = vw < 640;
  const w = Math.min(320, vw - 24);
  const style: React.CSSProperties = narrow
    ? box.top > vh / 2
      ? { top: 12, left: 12, right: 12 }
      : { bottom: 12, left: 12, right: 12 }
    : placeTip(box, vw, vh, w, tipH);

  return (
    <>
      <div
        aria-hidden
        className="fixed z-[55] pointer-events-none rounded-xl ring-2 ring-blue-400 transition-all duration-200"
        style={{
          top: box.top - 6,
          left: box.left - 6,
          width: box.width + 12,
          height: box.height + 12,
          boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.5), 0 0 24px 4px rgba(96, 165, 250, 0.55)',
        }}
      />
      <div ref={tipRef} role="dialog" aria-label={hint.title} className="fixed z-[56] bg-slate-800 border border-blue-400/60 rounded-2xl shadow-2xl p-4" style={style}>
        <h3 className="text-base font-semibold text-slate-100 mb-1">{hint.title}</h3>
        <p className="text-sm text-slate-300 mb-3">{hint.body}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => onSeen(hint.id)} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">
            Got it
          </button>
          {hint.link && (
            <Link href={hint.link.href} onClick={() => onSeen(hint.id)} className="text-sm font-semibold text-blue-300 hover:text-blue-200">
              {hint.link.label} →
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
