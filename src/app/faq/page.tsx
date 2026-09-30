'use client';

import { useState } from 'react';
import Link from 'next/link';

const FAQS: { q: string; a: string }[] = [
  {
    q: 'Who is Relay TC for?',
    a: 'Transaction coordinators and real estate agents who manage the paperwork and checklist between an accepted contract and closing day — solo TCs, brokerage support staff, and small teams.',
  },
  {
    q: 'What happens when I create a new transaction?',
    a: 'Relay automatically builds a standard closing checklist (Contract & File Setup, Earnest Money & Option, Inspection & Repairs, Title/Appraisal & Financing, Clear to Close, Closing & Post-Closing) so you’re not starting from a blank page on every deal.',
  },
  {
    q: 'Can I upload documents to a transaction?',
    a: 'Yes. Upload PDFs, images, or other files directly onto any checklist step, or as a general document on the transaction. Files are stored securely and downloaded through short-lived, signed links rather than public URLs.',
  },
  {
    q: 'How are agent fees and invoices calculated?',
    a: 'Most transaction coordinators are paid a flat fee per deal, and that\'s the default in Relay. You can also add an optional percentage-based fee on the purchase price for agents who work that way. When you mark a transaction Closed, Relay calculates the total and generates the invoice automatically.',
  },
  {
    q: 'Do the agents I work with need their own Relay account?',
    a: 'No. You create an agent profile with their fee structure and contact details — agents don’t need to log in or have an account of their own.',
  },
  {
    q: 'What’s included on the free Starter plan?',
    a: 'Starter includes unlimited transactions, 1 agent profile, auto-built checklists, document uploads, and manual invoicing — enough to run your whole pipeline through Relay with no credit card required to start.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Yes, from your dashboard. Upgrading takes effect immediately; nothing about your existing transactions, agents, or invoices changes when you switch plans.',
  },
  {
    q: 'What if I delete a transaction, agent, or invoice by mistake?',
    a: 'Each has a delete option with a confirmation step first. Deleting a transaction also removes its checklist, uploaded documents, and any invoice generated from it, so you don’t end up with orphaned records.',
  },
  {
    q: 'Is there a team/multi-user option?',
    a: 'The Team plan is built for a shared workspace — a shared agent roster and visibility across the team’s transactions, billed per seat with a 3-seat minimum.',
  },
  {
    q: 'What happens to my data if I stop paying?',
    a: 'Your account and data stay in place. Features tied to a paid plan (like unlimited transactions) apply again if you upgrade later — nothing is deleted for downgrading.',
  },
];

export default function FAQPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Nav */}
      <header className="border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="w-9 h-9 bg-white rounded-lg flex items-center justify-center p-1.5 shadow-sm">
              <img src="/relay-icon.png" alt="Relay TC" className="w-full h-full object-contain" />
            </span>
          </Link>
          <nav className="hidden sm:flex items-center gap-8 text-sm text-slate-300">
            <Link href="/pricing" className="hover:text-slate-100 transition">Pricing</Link>
            <Link href="/faq" className="text-slate-100">FAQ</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/agent/login" className="hidden sm:inline text-sm text-slate-500 hover:text-slate-300 transition">Agent Login</Link>
            <Link href="/auth" className="text-sm text-slate-300 hover:text-slate-100 transition">Sign In</Link>
            <Link
              href="/auth?mode=signup&plan=starter"
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* Header */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-12 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">FAQ</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Questions, answered.
        </h1>
        <p className="text-lg text-slate-400">Everything you need to know before you bring Relay into your workflow.</p>
      </section>

      {/* Accordion */}
      <section className="max-w-3xl mx-auto px-6 pb-24">
        <div className="divide-y divide-slate-700 border-t border-b border-slate-700">
          {FAQS.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div key={item.q}>
                <button
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-4 py-5 text-left"
                >
                  <span className="font-medium text-slate-100">{item.q}</span>
                  <svg
                    className={`w-5 h-5 text-slate-500 flex-shrink-0 transition-transform ${isOpen ? 'rotate-45' : ''}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                </button>
                {isOpen && <p className="text-slate-400 text-sm leading-relaxed pb-6 pr-8">{item.a}</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 pb-20 text-center">
        <p className="text-slate-400 mb-6">Still have questions?</p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/auth?mode=signup&plan=starter"
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition"
          >
            Start free
          </Link>
          <Link href="/pricing" className="px-6 py-3 border border-slate-600 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">
            See pricing
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/relay-icon.png" alt="Relay TC" className="w-6 h-6 object-contain" />
            <span className="text-sm text-slate-400">Relay TC</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <Link href="/" className="hover:text-slate-200 transition">Home</Link>
            <Link href="/pricing" className="hover:text-slate-200 transition">Pricing</Link>
            <Link href="/auth" className="hover:text-slate-200 transition">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
