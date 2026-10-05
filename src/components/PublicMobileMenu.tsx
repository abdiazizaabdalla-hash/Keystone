'use client';

import { useState } from 'react';
import Link from 'next/link';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
  { href: '/for-agents', label: 'For Agents' },
];

// Mobile-only replacement for the public header's desktop nav (which is
// `hidden sm:flex`). Hidden from `sm` up so the desktop nav is unchanged.
export default function PublicMobileMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="public-mobile-menu"
        className="p-2 text-slate-300 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>
      {open && (
        <div
          id="public-mobile-menu"
          className="absolute left-0 top-full mt-2 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden z-50"
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block px-4 py-3 text-sm text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition"
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
