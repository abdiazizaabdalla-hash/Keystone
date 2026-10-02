'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PLANS } from '@/lib/plans';
import { decodeStoredRole } from '@/lib/authClient';
import DemoRequestButton from '@/components/DemoRequestButton';

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      // auth_token is shared storage for both TC and agent-portal sessions
      // (see lib/authClient.ts) -- sending an already-logged-in agent
      // through this TC-only redirect used to land them in /dashboard,
      // which then bounced them into the TC onboarding wizard (they have
      // no agents-table rows of their own, so needsOnboarding was always
      // true for them). Check which kind of session this actually is
      // before deciding where "already signed in" should go.
      router.push(decodeStoredRole() === 'agent' ? '/agent' : '/dashboard');
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
            <Link href="/for-agents" className="hover:text-slate-100 transition">For Agents</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link
              href="/agent/login"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-500/40 bg-blue-500/10 text-sm text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 transition"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              Agent Login
            </Link>
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
            Every transaction.<br />
            <span className="italic text-blue-400">One workspace.</span>
          </h1>
          <p className="text-lg text-slate-400 mb-8 max-w-lg">
            Relay keeps your transactions organized, your deadlines on track, and your agents
            connected — from an accepted contract to a closed deal. One place for the checklist,
            the paperwork, the payout, and everyone who needs to stay in the loop.
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
            <DemoRequestButton
              className="px-6 py-3 text-slate-300 hover:text-slate-100 font-semibold transition"
              label="Request a demo"
            />
          </div>
          <p className="text-xs text-slate-500 mt-4">Free for 30 days, or until your first paid deal closes. No credit card required.</p>
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

      {/* The problem */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Stop managing transactions across scattered tools</h2>
            <p className="text-slate-400 mb-4">
              A checklist in one app, documents in email, deadlines in a calendar you forget to
              check, and an agent texting you for a status update. Relay keeps the checklist, the
              paperwork, the deadlines, the messages, and the invoice all attached to the one
              transaction they belong to.
            </p>
            <p className="text-slate-400">
              You open one page and see exactly where a deal stands — what&apos;s done, what&apos;s
              overdue, and what&apos;s waiting on someone else.
            </p>
          </div>
          <div className="grid gap-3">
            {[
              'Every deal gets a standard closing checklist the moment you create it',
              'Documents live on the checklist step they belong to, not buried in an inbox',
              'A daily digest flags what’s overdue or due today — before an agent has to ask',
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

      {/* Core workflow / features */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-2">Everything for the deal, organized together</h2>
        <p className="text-slate-400 mb-12 max-w-2xl">One place for the checklist, the paperwork, and the payout — instead of three.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              title: 'Auto-built checklists',
              body: 'Every new deal gets a standard closing checklist the moment you create it, with deadlines you control.',
            },
            {
              title: 'Documents by category',
              body: 'Upload contracts, disclosures, and inspection reports into the right category, linked to the checklist step they belong to.',
            },
            {
              title: 'Built-in e-signatures',
              body: 'Send a document out for signature with a secure link — no separate DocuSign account needed — or mark something signed outside Relay.',
            },
            {
              title: 'Invoicing, your way',
              body: 'Generate the invoice when a deal closes, send it by email, and let agents pay through your connected Stripe account — or mark it paid however they actually paid you.',
            },
            {
              title: 'Every deal, organized',
              body: 'Every transaction — open or closed — plus every agent’s fee and payment history, always on record and a click away.',
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

      {/* Agent Portal */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="order-2 lg:order-1">
            <div className="rounded-xl border border-slate-700 overflow-hidden shadow-2xl bg-slate-800">
              <img
                src="/screenshots/agent-conversation.jpg"
                alt="An agent's view of a transaction in Relay, mid-conversation with their TC about an inspection report and a requested repair credit"
                className="w-full h-auto block"
              />
            </div>
            <p className="text-xs text-slate-500 mt-3 text-center lg:text-left">What the agent sees</p>
          </div>
          <div className="order-1 lg:order-2">
            <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Agent Portal</p>
            <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Your agents get their own place to collaborate</h2>
            <p className="text-slate-400 mb-4">
              Invite an agent onto a deal and they get a free, scoped-down login — no credit
              card, no separate subscription. They can message you, upload documents, check
              deadlines, and see exactly where their deal stands, all without ever seeing your
              other clients, your invoices, or your billing.
            </p>
            <p className="text-slate-400 mb-6">
              One invited login works across every TC an agent works with — so an agent who
              closes deals with three different coordinators sees all three in one place.
            </p>
            <ul className="space-y-2.5 text-sm text-slate-300">
              {[
                'View checklist progress, dates, and the transaction status',
                'Upload documents, and mark whether one is signed',
                'Message you directly, with file attachments, right on the deal',
                'Add a contact they know about — a lender, an inspector',
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {line}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500 mt-6">
              Agents can&apos;t check off your checklist, send a signature request, or see anything about your other deals — you stay in control of the transaction.
            </p>
            <Link
              href="/for-agents"
              className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 font-medium transition mt-6"
            >
              Are you an agent? See what you can do →
            </Link>
          </div>
        </div>
      </section>

      {/* Documents */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Documents</p>
            <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Every file, sorted into the right category automatically</h2>
            <p className="text-slate-400">
              Contracts, disclosures, inspection reports — upload into the category it belongs to,
              and track whether it still needs a signature, right next to the checklist step it
              supports.
            </p>
          </div>
          <div>
            <div className="rounded-xl border border-slate-700 overflow-hidden shadow-2xl bg-slate-800">
              <img
                src="/screenshots/document-setup.jpg"
                alt="Documents on a transaction in Relay, organized into categories like Contract & Disclosures, Inspection & Repairs, and Title & Escrow"
                className="w-full h-auto block"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-12">Built for independent TCs and growing teams</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { title: 'Independent TC', body: 'Run your transaction coordination business in one place — checklist, documents, invoicing, all of it.' },
            { title: 'TC team', body: 'Manage transactions, coordinate work, and share oversight across your team on the Team plan.' },
            { title: 'Real estate agent', body: 'Work with your TC, send documents, and track your deal in one workspace — free, by invitation.' },
            { title: 'Brokerage', body: 'Give your agents a consistent place to manage transactions with the TCs they already work with.' },
          ].map((card) => (
            <div key={card.title} className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
              <h3 className="font-semibold text-slate-100 mb-2">{card.title}</h3>
              <p className="text-sm text-slate-400">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
          <div>
            <h2 className="font-display text-3xl font-semibold text-slate-100 mb-2">Simple plans that grow with your business</h2>
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
        <p className="text-center text-xs text-slate-500 mt-6">The agent portal is free on every plan — agents you invite never need a Relay subscription of their own.</p>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Make your next closing easier to manage</h2>
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
            <Link href="/for-agents" className="hover:text-slate-200 transition">For Agents</Link>
            <Link href="/terms" className="hover:text-slate-200 transition">Terms</Link>
            <Link href="/privacy" className="hover:text-slate-200 transition">Privacy</Link>
            <Link href="/auth" className="hover:text-slate-200 transition">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
