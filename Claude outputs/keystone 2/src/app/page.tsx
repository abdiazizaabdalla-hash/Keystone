'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      router.push('/dashboard');
    } else {
      setChecking(false);
    }
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen bg-ink-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-ink-700 border-t-amber-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950">
      {/* Nav */}
      <header className="border-b border-ink-800">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/relay-icon.png" alt="Relay TC" className="w-9 h-9 object-contain" />
            <span className="font-display font-semibold text-lg text-ink-100">Relay TC</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-8 text-sm text-ink-300">
            <Link href="/pricing" className="hover:text-ink-100 transition">Pricing</Link>
            <Link href="/faq" className="hover:text-ink-100 transition">FAQ</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/auth" className="text-sm text-ink-300 hover:text-ink-100 transition">Sign In</Link>
            <Link
              href="/auth?mode=signup&plan=starter"
              className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-ink-950 text-sm font-semibold rounded-lg transition"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-amber-400 uppercase mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            From contract to closing
          </div>
          <h1 className="font-display text-5xl sm:text-6xl font-semibold text-ink-100 leading-[1.05] mb-6">
            Every deal, on track.<br />
            <span className="italic text-amber-400">Ready for close.</span>
          </h1>
          <p className="text-lg text-ink-400 mb-8 max-w-lg">
            Relay keeps your checklist, documents, agents, and invoices in one place —
            so nothing falls through the cracks between contract and closing day.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/auth?mode=signup&plan=starter"
              className="px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-ink-950 font-semibold rounded-lg transition shadow-lg shadow-amber-500/10"
            >
              Start free
            </Link>
            <Link
              href="/pricing"
              className="px-6 py-3 border border-ink-700 hover:border-ink-600 text-ink-200 font-semibold rounded-lg transition"
            >
              See pricing
            </Link>
          </div>
          <p className="text-xs text-ink-500 mt-4">Free to start. No credit card required.</p>
        </div>

        {/* Mock product preview */}
        <div className="relative">
          <div className="bg-gradient-to-br from-ink-800/80 to-ink-900/80 border border-ink-700 rounded-xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <span className="inline-block px-2.5 py-1 bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-semibold rounded-full">
                  Under Contract
                </span>
                <h3 className="text-xl font-semibold text-ink-100 mt-3">412 Cypress Lane</h3>
                <p className="text-sm text-ink-500">FL-2026-00412</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-ink-500 uppercase tracking-wide">Price</p>
                <p className="text-lg font-semibold text-amber-400">$415,000</p>
              </div>
            </div>
            <div className="mb-5">
              <div className="flex justify-between text-xs text-ink-500 mb-1.5">
                <span>Checklist progress</span>
                <span className="text-amber-400 font-semibold">67%</span>
              </div>
              <div className="w-full h-2 bg-ink-700 rounded-full overflow-hidden">
                <div className="h-full w-2/3 bg-gradient-to-r from-amber-500 to-amber-600" />
              </div>
            </div>
            <div className="space-y-2">
              {[
                { name: 'Pre-Inspection', done: true },
                { name: 'Inspection', done: true },
                { name: 'Appraisal', done: true },
                { name: 'Underwriting', done: false },
              ].map((task) => (
                <div key={task.name} className="flex items-center gap-3 px-3 py-2 bg-ink-900/60 border border-ink-700/80 rounded-lg text-sm">
                  <span
                    className={`w-4 h-4 rounded-sm border flex items-center justify-center ${
                      task.done ? 'bg-amber-500 border-amber-500' : 'border-ink-600'
                    }`}
                  >
                    {task.done && (
                      <svg className="w-3 h-3 text-ink-950" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                  <span className={task.done ? 'text-ink-400 line-through' : 'text-ink-200'}>{task.name}</span>
                  {task.name === 'Inspection' && (
                    <span className="ml-auto text-xs text-amber-400">📄 2 files</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="absolute -z-10 -top-8 -right-8 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl" />
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-ink-800">
        <h2 className="font-display text-3xl font-semibold text-ink-100 mb-2">Built for how TCs actually work</h2>
        <p className="text-ink-400 mb-12 max-w-2xl">One place for the checklist, the paperwork, and the payout — instead of three.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              title: 'Auto-built checklists',
              body: 'Every new deal gets a standard closing checklist the moment you create it.',
            },
            {
              title: 'Documents per step',
              body: 'Upload contracts, disclosures, and inspection reports directly onto the task they belong to.',
            },
            {
              title: 'Invoices that generate themselves',
              body: 'Closing a deal calculates the agent\'s fee and creates the invoice automatically.',
            },
            {
              title: 'One view of every agent',
              body: 'Flat fees, percentage splits, and every open deal per agent, in one place.',
            },
          ].map((f) => (
            <div key={f.title} className="p-6 bg-ink-900/60 border border-ink-800 rounded-xl">
              <h3 className="font-semibold text-ink-100 mb-2">{f.title}</h3>
              <p className="text-sm text-ink-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-ink-800">
        <h2 className="font-display text-3xl font-semibold text-ink-100 mb-12">From listing to payout</h2>
        <div className="grid sm:grid-cols-3 gap-8">
          {[
            { n: '1', title: 'Add your agents', body: 'Set each agent’s flat fee, and an optional percentage fee if they use one.' },
            { n: '2', title: 'Create the deal', body: 'Property, price, agent — Relay builds the checklist for you.' },
            { n: '3', title: 'Close & get paid', body: 'Mark it closed and the invoice is ready to send.' },
          ].map((step) => (
            <div key={step.n}>
              <div className="w-10 h-10 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-400 font-semibold flex items-center justify-center mb-4">
                {step.n}
              </div>
              <h3 className="font-semibold text-ink-100 mb-2">{step.title}</h3>
              <p className="text-sm text-ink-400">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-ink-800">
        <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
          <div>
            <h2 className="font-display text-3xl font-semibold text-ink-100 mb-2">Simple, honest pricing</h2>
            <p className="text-ink-400">Start free. Upgrade when Relay becomes part of every closing.</p>
          </div>
          <Link href="/pricing" className="text-amber-400 hover:text-amber-300 font-medium text-sm">
            Full pricing details →
          </Link>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
          {[
            { name: 'Starter', price: '$0', tag: null },
            { name: 'Pro', price: '$29/mo', tag: 'Most popular' },
            { name: 'Team', price: '$19/seat/mo', tag: null },
          ].map((p) => (
            <div key={p.name} className={`p-6 rounded-xl border ${p.tag ? 'border-amber-500/60 bg-amber-500/5' : 'border-ink-800 bg-ink-900/60'}`}>
              {p.tag && <p className="text-xs font-semibold text-amber-400 uppercase tracking-wide mb-2">{p.tag}</p>}
              <h3 className="font-semibold text-ink-100">{p.name}</h3>
              <p className="text-2xl font-display font-semibold text-ink-100 mt-1">{p.price}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-ink-800 text-center">
        <h2 className="font-display text-3xl font-semibold text-ink-100 mb-4">Ready to get every deal organized?</h2>
        <Link
          href="/auth?mode=signup&plan=starter"
          className="inline-block px-8 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-ink-950 font-semibold rounded-lg transition"
        >
          Start free
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink-800">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/relay-icon.png" alt="Relay TC" className="w-6 h-6 object-contain" />
            <span className="text-sm text-ink-400">Relay TC</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-ink-500">
            <Link href="/pricing" className="hover:text-ink-200 transition">Pricing</Link>
            <Link href="/faq" className="hover:text-ink-200 transition">FAQ</Link>
            <Link href="/auth" className="hover:text-ink-200 transition">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
