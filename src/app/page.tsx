'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PUBLIC_PLANS } from '@/lib/plans';
import { decodeStoredRole } from '@/lib/authClient';
import DemoRequestButton from '@/components/DemoRequestButton';
import HomeVideo from '@/components/HomeVideo';
import PublicMobileMenu from '@/components/PublicMobileMenu';
import { DealFlowIllustration, PortalIllustration, TeamIllustration, AgentPathsIllustration, BrokerageDashboardIllustration, AutomationFlowIllustration, PayFlowIllustration, TemplateSharingIllustration, AutomationAudiencesIllustration } from '@/components/marketing/Illustrations';

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
      return;
    }
    // Deferred so the state update is not a synchronous effect update.
    const t = setTimeout(() => setChecking(false), 0);
    return () => clearTimeout(t);
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
      <header className="sticky top-0 z-50 border-b border-slate-700 bg-slate-900/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PublicMobileMenu />
            <Link href="/" className="flex items-center gap-2">
              <span className="w-9 h-9 bg-white rounded-lg flex items-center justify-center p-1.5 shadow-sm">
                <img src="/relay-icon.png" alt="Relay TC" className="w-full h-full object-contain" />
              </span>
            </Link>
          </div>
          <nav className="hidden sm:flex items-center gap-8 text-sm text-slate-300">
            <Link href="/" className="hover:text-slate-100 transition">Home</Link>
            <Link href="/for-tcs" className="hover:text-slate-100 transition">For TCs</Link>
            <Link href="/for-agents" className="hover:text-slate-100 transition">For Agents</Link>
            <Link href="/for-brokerages" className="hover:text-slate-100 transition">For Brokerages</Link>
            <Link href="/pricing" className="hover:text-slate-100 transition">Pricing</Link>
            <Link href="/faq" className="hover:text-slate-100 transition">FAQ</Link>
          </nav>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/agent/login"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-500/40 bg-blue-500/10 text-sm text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 transition whitespace-nowrap"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              Portal Login
            </Link>
            <Link href="/auth" className="hidden sm:inline text-sm text-slate-300 hover:text-slate-100 transition whitespace-nowrap">Sign In</Link>
            <Link
              href="/get-started"
              className="px-3 sm:px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition whitespace-nowrap"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 grid lg:grid-cols-[5fr_6fr] gap-12 items-center">
        <div>
          <span className="inline-block bg-white rounded-xl p-4 mb-3 shadow-md -ml-4">
            <img src="/relay-logo.png" alt="Relay TC" className="h-14 w-auto object-contain" />
          </span>
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-blue-400 uppercase mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            Contract to closing
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-slate-100 leading-[1.1] mb-6">
            Transaction coordination,<br />
            <span className="text-blue-400">without the coordination headache.</span>
          </h1>
          <p className="text-lg text-slate-400 mb-8 max-w-lg">
            One place for every deal, for the coordinators who run them, the agents who close them and the brokerages that oversee them.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/get-started"
              className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10"
            >
              Get started
            </Link>
            <a
              href="#demo"
              className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition"
            >
              Explore Relay
            </a>
          </div>
          <p className="text-xs text-slate-500 mt-4">
            Free for 14 days. No credit card required.{' '}
            <a href="#demo" className="text-blue-400 hover:text-blue-300">Watch the video</a>
          </p>
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
                <div className="h-full w-2/3 bg-blue-500" />
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

      {/* Product video: click to play, nothing loads until then */}
      <section className="max-w-6xl mx-auto px-6 pb-16">
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { href: '/for-tcs', who: 'TCs', line: 'Run every file from contract to closing. Teams welcome.', price: 'From $19 a month' },
            { href: '/for-agents', who: 'Agents', line: 'Your own workspace for your deals, from your brokerage or on your own.', price: '$0 with your brokerage, or $19' },
            { href: '/for-brokerages', who: 'Brokerages', line: 'See every agent and every file, with required documents checked.', price: 'From $99 a month' },
          ].map((c) => (
            <Link key={c.href} href={c.href} className="block bg-slate-800/60 border border-slate-700 hover:border-blue-400/60 rounded-xl p-6 transition">
              <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-2">For</p>
              <h2 className="font-display text-2xl font-semibold text-slate-100 mb-2">{c.who}</h2>
              <p className="text-sm text-slate-400 mb-4">{c.line}</p>
              <p className="text-sm font-semibold text-slate-200">{c.price} <span className="text-blue-400">→</span></p>
            </Link>
          ))}
        </div>
      </section>

      <section id="demo" className="max-w-4xl mx-auto px-6 pb-16 scroll-mt-4">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">See it in a minute</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100">Every closing has moving parts. Relay brings them together.</h2>
        </div>
        <HomeVideo />
      </section>

      {/* Snapshot: one deal, start to finish */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">How it works</p>
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">One deal, from contract to closing.</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">Upload the contract and Relay builds the deal. From there the dates, checklist, documents, messages and invoice all live on one page.</p>
        <DealFlowIllustration />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {[
            { step: '1', title: 'Read the contract', body: 'AI fills in the transaction or listing from the PDF.' },
            { step: '2', title: 'Dates and checklist', body: 'Critical dates and a dated closing checklist, kept current as dates move.' },
            { step: '3', title: 'Documents and signatures', body: 'Collect documents, send for e-signature, message the parties.' },
            { step: '4', title: 'Invoice and get paid', body: 'Invoice the agent, accept online payment, export to QuickBooks.' },
          ].map((s) => (
            <div key={s.step} className="p-5 bg-slate-800/60 border border-slate-700 rounded-xl">
              <span className="w-7 h-7 rounded-full bg-blue-500/15 border border-blue-400/60 text-blue-300 text-sm font-semibold flex items-center justify-center mb-3">{s.step}</span>
              <h3 className="font-semibold text-slate-100 mb-1">{s.title}</h3>
              <p className="text-sm text-slate-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Snapshot: who it is for */}
      <section id="who" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Who it is for</p>
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">The same deal, seen from each seat.</h2>
        <p className="text-slate-400 mb-10 max-w-2xl">Relay works the same way for everyone on the file. What changes is what you see and what you can do.</p>

        <div className="space-y-14">
          {[
            {
              id: 'tcs',
              label: 'Transaction coordinators',
              title: 'Run every file from one workspace.',
              body: 'Contracts, dates, checklists, documents, invoices and your agents’ logins, without the spreadsheet.',
              bullets: ['AI contract intake, listings and transactions', 'Your own checklist templates and automated reminders', 'Invoices with online payment and QuickBooks files', 'Agent portal with the deals you choose to share'],
              href: '/for-tcs',
              cta: 'See Relay for TCs',
              art: <PortalIllustration />,
            },
            {
              id: 'teams',
              label: 'TC teams',
              title: 'Lead a team without reading their files.',
              body: 'Team owners get a status-only desk across the team. Each member’s deals, prices, documents and clients stay private to them.',
              bullets: ['Team desk with stalled and overdue status', 'A default checklist the whole team starts from', 'Team automations, digests and trends', 'Get paid through Relay with Stripe'],
              href: '/for-tcs#teams',
              cta: 'See team features',
              art: <TeamIllustration />,
              reverse: true,
            },
            {
              id: 'agents',
              label: 'Agents',
              title: 'Your own deals, your own workspace.',
              body: 'Get a workspace from your brokerage at no cost to you, or subscribe to Agent Pro on your own.',
              bullets: ['Run your own deals and listings', 'Read a contract and fill in the deal', 'Your TC’s updates and documents in one place', 'Templates and automations on Agent Pro'],
              href: '/for-agents',
              cta: 'See Relay for agents',
              art: <AgentPathsIllustration />,
            },
            {
              id: 'brokerages',
              label: 'Brokerages',
              title: 'See every file. Set the standard once.',
              body: 'A compliance desk and file review across your roster, with the required steps and document lists every agent works from.',
              bullets: ['Compliance desk and file review', 'Required steps and document lists, pushed to every agent', 'Automations, reports and trends', 'Managing accounts with scoped roles, and commissions paid through Relay'],
              href: '/for-brokerages',
              cta: 'See Relay for brokerages',
              art: <BrokerageDashboardIllustration />,
              reverse: true,
            },
          ].map((a) => (
            <div key={a.id} id={a.id} className="grid lg:grid-cols-2 gap-8 items-center scroll-mt-4">
              <div className={a.reverse ? 'lg:order-2' : ''}>
                <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">{a.label}</p>
                <h3 className="font-display text-2xl font-semibold text-slate-100 mb-3">{a.title}</h3>
                <p className="text-slate-400 mb-4">{a.body}</p>
                <ul className="space-y-2 text-sm text-slate-300 mb-5">
                  {a.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5">
                      <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      {b}
                    </li>
                  ))}
                </ul>
                <Link href={a.href} className="text-blue-400 hover:text-blue-300 font-medium text-sm">{a.cta} →</Link>
              </div>
              <div className={a.reverse ? 'lg:order-1' : ''}>{a.art}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Snapshot: workflows that run themselves */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Workflow</p>
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Reminders, templates and payments that run themselves.</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">Set it up once. Relay sends the reminders, shares the templates and keeps the money with the deal.</p>
        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <p className="text-sm text-slate-400 mb-3">Automations: a reminder that sends itself.</p>
            <AutomationFlowIllustration />
          </div>
          <div>
            <p className="text-sm text-slate-400 mb-3">Invoices: from the deal to paid to your books.</p>
            <PayFlowIllustration />
          </div>
          <div>
            <p className="text-sm text-slate-400 mb-3">Templates: a brokerage shares one with every agent.</p>
            <TemplateSharingIllustration />
          </div>
          <div>
            <p className="text-sm text-slate-400 mb-3">Automations: for TCs, teams, agents and brokerages.</p>
            <AutomationAudiencesIllustration />
          </div>
        </div>
      </section>

      {/* Snapshot: everything else */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">And the rest of the file.</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">Everything else a closing needs, already in the app.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            { title: 'Calendar sync', body: 'Google Calendar updates within seconds. Outlook and Apple subscribe by a private link.' },
            { title: 'Import your work', body: 'CSV deal import with a preview, and a contacts list that fills itself from your deals.' },
            { title: 'QuickBooks files', body: 'Download invoices in QuickBooks’ import layout, or upload an export to match invoices.' },
            { title: 'Documents and e-signatures', body: 'Collect documents per deal and send them for signature.' },
            { title: 'Listings to transactions', body: 'Convert a listing to a transaction in one click.' },
            { title: 'Daily digest', body: 'Overdue, due-today and waiting items on your dashboard and in your inbox.' },
          ].map((f) => (
            <div key={f.title} className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
              <h3 className="font-semibold text-slate-100 mb-2">{f.title}</h3>
              <p className="text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>


      {/* Pricing teaser */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
          <div>
            <h2 className="font-display text-3xl font-semibold text-slate-100 mb-2">Simple plans for every seat.</h2>
            <p className="text-slate-400">Try Relay free and see how it fits into your workflow. Upgrade when you need more agents, automations or team features.</p>
          </div>
          <Link href="/pricing" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
            Full pricing details →
          </Link>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
          {PUBLIC_PLANS.map((plan) => (
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
        <p className="text-xs text-slate-500 mt-6">Agent and brokerage plans are on the <Link href="/pricing" className="text-blue-400 hover:text-blue-300">pricing page</Link>.</p>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <h2 className="font-display text-3xl font-semibold text-slate-100">Run your next closing in Relay.</h2>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/get-started"
              className="inline-block px-8 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition"
            >
              Start free
            </Link>
            <DemoRequestButton
              className="px-6 py-3 text-slate-300 hover:text-slate-100 font-semibold transition"
              label="Request a demo"
            />
          </div>
        </div>
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
            <Link href="/for-tcs" className="hover:text-slate-200 transition">For TCs</Link>
            <Link href="/for-agents" className="hover:text-slate-200 transition">For Agents</Link>
            <Link href="/for-brokerages" className="hover:text-slate-200 transition">For Brokerages</Link>
            <Link href="/pricing" className="hover:text-slate-200 transition">Pricing</Link>
            <Link href="/faq" className="hover:text-slate-200 transition">FAQ</Link>
            <Link href="/auth" className="hover:text-slate-200 transition">Sign In</Link>
            <Link href="/terms" className="hover:text-slate-200 transition">Terms</Link>
            <Link href="/privacy" className="hover:text-slate-200 transition">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
