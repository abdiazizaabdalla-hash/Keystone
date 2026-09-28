'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PLANS } from '@/lib/plans';

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
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-slate-700 border-t-blue-400 animate-spin" />
      </div>
    );
  }

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
            <Link href="/faq" className="hover:text-slate-100 transition">FAQ</Link>
          </nav>
          <div className="flex items-center gap-4">
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

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <span className="inline-block bg-white rounded-xl p-4 mb-3 shadow-md -ml-4">
            <img src="/relay-logo.png" alt="Relay TC" className="h-14 w-auto object-contain" />
          </span>
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-blue-400 uppercase mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            From contract to closing
          </div>
          <h1 className="font-display text-5xl sm:text-6xl font-semibold text-slate-100 leading-[1.05] mb-6">
            Every deal, on track.<br />
            <span className="italic text-blue-400">Ready for close.</span>
          </h1>
          <p className="text-lg text-slate-400 mb-8 max-w-lg">
            Relay is full transaction coordinator (TC) management software — keeping your
            checklist, documents, agents, and invoices in one place so nothing falls through
            the cracks between contract and closing day.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/auth?mode=signup&plan=starter"
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10"
            >
              Start free
            </Link>
            <Link
              href="/pricing"
              className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition"
            >
              See pricing
            </Link>
          </div>
          <p className="text-xs text-slate-500 mt-4">Free for 30 days. No credit card required.</p>
        </div>

        {/* Mock product preview */}
        <div className="relative">
          <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-slate-700 rounded-xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <span className="inline-block px-2.5 py-1 bg-blue-500/20 border border-blue-500/50 text-blue-300 text-xs font-semibold rounded-full">
                  Under Contract
                </span>
                <h3 className="text-xl font-semibold text-slate-100 mt-3">123 Main Street</h3>
                <p className="text-sm text-slate-500">FL-2026-00412</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500 uppercase tracking-wide">Price</p>
                <p className="text-lg font-semibold text-blue-400">$415,000</p>
              </div>
            </div>
            <div className="mb-5">
              <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                <span>Checklist progress</span>
                <span className="text-blue-400 font-semibold">67%</span>
              </div>
              <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full w-2/3 bg-gradient-to-r from-blue-500 to-blue-600" />
              </div>
            </div>
            <div className="space-y-2">
              {[
                { name: 'Contract & File Setup', done: true, files: 1 },
                { name: 'Earnest Money & Option', done: true, files: 2 },
                { name: 'Inspection & Repairs', done: true, files: 3 },
                { name: 'Title, Appraisal & Financing', done: false, files: 1 },
              ].map((task) => (
                <div key={task.name} className="flex items-center gap-3 px-3 py-2 bg-slate-900/60 border border-slate-700/80 rounded-lg text-sm">
                  <span
                    className={`w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0 ${
                      task.done ? 'bg-blue-500 border-blue-500' : 'border-slate-600'
                    }`}
                  >
                    {task.done && (
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                  <span className={`flex-1 ${task.done ? 'text-slate-400 line-through' : 'text-slate-200'}`}>{task.name}</span>
                  <span className="text-xs text-blue-400 text-right flex-shrink-0 w-16">
                    📄 {task.files} {task.files === 1 ? 'file' : 'files'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="absolute -z-10 -top-8 -right-8 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl" />
        </div>
      </section>

      {/* Get paid without chasing payments */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Get paid without chasing payments</h2>
            <p className="text-slate-400 mb-4">
              Every invoice Relay sends comes with a real way to pay it. Agents can check out
              online with Stripe right from the invoice, so you get paid without leaving the
              platform for a separate payment tool.
            </p>
            <p className="text-slate-400">
              Prefer another way? Zelle, PayPal, or anything else works too — mark the invoice
              paid manually and it stays on the record right alongside everything else.
            </p>
          </div>
          <div className="grid gap-3">
            {[
              'Pay online through Stripe — agents check out right from the invoice',
              'Or pay your way — Zelle, PayPal, or anything else, marked paid manually and tracked the same',
              'Invoices that build and send themselves — Pro and Team auto-generate the invoice at closing, ready to customize and email to the agent in one click',
            ].map((line) => (
              <div key={line} className="flex items-start gap-3 p-4 bg-slate-800/60 border border-slate-700 rounded-xl">
                <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-sm text-slate-300">{line}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-2">Built for how TCs actually work</h2>
        <p className="text-slate-400 mb-12 max-w-2xl">One place for the checklist, the paperwork, and the payout — instead of three.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
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
              body: 'On Pro and Team, closing a deal calculates the fee and generates the invoice automatically — customize it and email it straight to the agent in one click.',
            },
            {
              title: 'Get paid your way',
              body: 'Agents pay online through Stripe, or however you prefer \u2014 Zelle, PayPal, and more. Mark it paid manually and it\'s tracked right on the invoice.',
            },
            {
              title: 'Every deal, organized',
              body: 'Every transaction — open or closed — plus every agent\'s fee and payment history, always on record and a click away.',
            },
            {
              title: 'Custom checklist templates',
              body: 'Build your own checklist templates for the deal types you run most, on Pro and Team.',
            },
          ].map((f) => (
            <div key={f.title} className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
              <h3 className="font-semibold text-slate-100 mb-2">{f.title}</h3>
              <p className="text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-12">From listing to payout</h2>
        <div className="grid sm:grid-cols-3 gap-8">
          {[
            { n: '1', title: 'Add your agents', body: 'Set each agent’s flat fee, and an optional percentage fee if they use one.' },
            { n: '2', title: 'Create the deal', body: 'Property, price, agent — Relay builds the checklist for you.' },
            { n: '3', title: 'Close & get paid', body: 'Mark it closed and the invoice is ready to send.' },
          ].map((step) => (
            <div key={step.n}>
              <div className="w-10 h-10 rounded-full bg-blue-500/15 border border-blue-500/40 text-blue-400 font-semibold flex items-center justify-center mb-4">
                {step.n}
              </div>
              <h3 className="font-semibold text-slate-100 mb-2">{step.title}</h3>
              <p className="text-sm text-slate-400">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
          <div>
            <h2 className="font-display text-3xl font-semibold text-slate-100 mb-2">Simple, honest pricing</h2>
            <p className="text-slate-400">Start free. Upgrade when Relay becomes part of every closing.</p>
          </div>
          <Link href="/pricing" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
            Full pricing details →
          </Link>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
          {PLANS.map((plan) => (
            <div key={plan.id} className={`p-6 rounded-xl border flex flex-col ${plan.popular ? 'border-blue-500/60 bg-blue-500/5' : 'border-slate-700 bg-slate-800/60'}`}>
              {plan.popular && <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-2">Most popular</p>}
              <h3 className="font-semibold text-slate-100">{plan.name}</h3>
              <p className="text-2xl font-display font-semibold text-slate-100 mt-1">
                {plan.price}
                <span className="text-sm font-sans font-normal text-slate-400">{plan.period}</span>
              </p>
              <p className="text-sm text-slate-400 mt-3">{plan.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Ready to get every deal organized?</h2>
        <Link
          href="/auth?mode=signup&plan=starter"
          className="inline-block px-8 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition"
        >
          Start free
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 bg-white rounded-md flex items-center justify-center p-1 shadow-sm">
              <img src="/relay-icon.png" alt="Relay TC" className="w-full h-full object-contain" />
            </span>
            <span className="font-brand font-extrabold text-sm text-slate-300">Relay TC</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <Link href="/pricing" className="hover:text-slate-200 transition">Pricing</Link>
            <Link href="/faq" className="hover:text-slate-200 transition">FAQ</Link>
            <Link href="/auth" className="hover:text-slate-200 transition">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
