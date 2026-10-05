'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PUBLIC_PLANS } from '@/lib/plans';
import { decodeStoredRole } from '@/lib/authClient';
import DemoRequestButton from '@/components/DemoRequestButton';
import ShotRow from '@/components/ShotRow';

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
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 grid lg:grid-cols-[5fr_6fr] gap-12 items-center">
        <div>
          <span className="inline-block bg-white rounded-xl p-4 mb-3 shadow-md -ml-4">
            <img src="/relay-logo.png" alt="Relay TC" className="h-14 w-auto object-contain" />
          </span>
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-blue-400 uppercase mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            From contract to closing
          </div>
          <h1 className="font-display text-5xl sm:text-6xl font-semibold text-slate-100 leading-[1.05] mb-6">
            Contract to closing,<br />
            <span className="italic text-blue-400">all in one workspace.</span>
          </h1>
          <p className="text-lg text-slate-400 mb-8 max-w-lg">
            Relay helps transaction coordinators keep the checklist, documents, deadlines, agent
            communication, and invoicing together on every deal.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/auth?mode=signup&plan=starter"
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10"
            >
              Start free
            </Link>
            <a
              href="#how-it-works"
              className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition"
            >
              See how it works
            </a>
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

      <section id="how-it-works" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <ShotRow
          name="contract-intake.jpg"
          alt="Uploading a purchase contract in Relay so the deal details can be read from it"
          wide
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">AI contract intake</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Start with the contract, not a blank transaction.</h2>
          <p className="text-slate-400 mb-5">Upload the signed purchase contract and Relay pulls the key details into the new transaction. Check the information, make any changes, and create the deal.</p>
          <ul className="space-y-2.5 text-sm text-slate-300">
            {[
              "Property address and purchase price",
              "Key dates",
              "Buyer, seller, lender, and title contacts",
              "Agent",
              "Review before creating the transaction",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                {line}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500 mt-4">Included on every plan.</p>
        </ShotRow>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">The transaction workspace</p>
            <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Every deal gets its own page.</h2>
            <p className="text-slate-400">
              Open a transaction and everything for that deal is right there, from the checklist
              and documents to the messages, contacts, and invoice.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              'Checklist',
              'Documents',
              'Messages',
              'Contacts',
              'Invoice',
              'Payment status',
            ].map((line) => (
              <div key={line} className="flex items-center gap-3 p-4 bg-slate-800/60 border border-slate-700 rounded-xl">
                <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                <span className="text-sm text-slate-300">{line}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <ShotRow
          name="checklist.jpg"
          alt="A transaction checklist in Relay with steps like Contract & File Setup and Inspection & Repairs, a progress bar, and due dates"
          reverse
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Workflow</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Know what needs to happen next.</h2>
          <p className="text-slate-400 mb-5">Each transaction starts with a closing checklist. Set deadlines for each step and keep track of what is done, what is coming up, and what needs attention.</p>
          <ul className="space-y-2.5 text-sm text-slate-300">
            {[
              "A default closing checklist on every deal",
              "Due dates based on acceptance, closing, or a fixed date, updated when the dates change",
              "Your own templates for different deal types (Pro and Team)",
              "Overdue, due-today, waiting, and upcoming items show on your dashboard and in a daily email digest",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                {line}
              </li>
            ))}
          </ul>
        </ShotRow>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <ShotRow
          name="agent-full-view.jpg"
          alt="The agent portal view of a transaction, with documents by category, a message thread, checklist progress, and contacts"
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Agent portal</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Give your agents their own view of the deal.</h2>
          <p className="text-slate-400 mb-5">Agents get a free portal where they can check progress, upload documents, message you, and see their invoice. They only see the transactions and information you&apos;ve shared with them.</p>
          <ul className="space-y-2.5 text-sm text-slate-300">
            {[
              "See transaction status and dates",
              "View checklist progress",
              "Upload documents",
              "Message you, with file attachments",
              "View their invoices",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                {line}
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold text-slate-200 mt-5">Agents never need a paid Relay subscription.</p>
          <Link
            href="/for-agents"
            className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 font-medium transition mt-4"
          >
            See the agent portal &rarr;
          </Link>
        </ShotRow>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <ShotRow
          name="invoice.jpg"
          alt="The Invoices page in Relay showing total invoiced, outstanding, and received amounts"
          wide
          reverse
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Invoicing</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Keep invoicing with the deal.</h2>
          <p className="text-slate-400 mb-5">Generate an invoice from the transaction, send it to the agent, and keep the payment status with the rest of the deal.</p>
          <ul className="space-y-2.5 text-sm text-slate-300">
            {[
              "Generate and send invoices",
              "Accept online payment through your Stripe account",
              "Track paid and unpaid status",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                {line}
              </li>
            ))}
          </ul>
        </ShotRow>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-8">Everything you need to run the deal</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { title: "Built-in e-signatures", body: 'Send a document for signature from the transaction. No separate DocuSign account.' },
            { title: "Document organization", body: 'Documents sorted into categories and linked to checklist steps.' },
            { title: "Agent messaging", body: 'Message agents on the deal and attach files.' },
            { title: "Email-to-transaction", body: 'Forward or CC an email to the deal and it lands on the transaction, attachments included.' },
            { title: "Daily digest", body: 'A morning email with overdue and due-today steps.' },
            { title: "Custom templates", body: 'Build checklists for different deal types. Pro and Team.' },
            { title: "Team workspaces", body: 'Share a workspace with other coordinators. The owner sees the team’s files.' },
            { title: "Payment tracking", body: 'See which invoices are paid and which are still outstanding.' },
          ].map((f) => (
            <div key={f.title} className="p-5 bg-slate-800/60 border border-slate-700 rounded-xl">
              <h3 className="font-semibold text-slate-100 text-sm mb-1.5">{f.title}</h3>
              <p className="text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
          <div>
            <h2 className="font-display text-3xl font-semibold text-slate-100 mb-2">Simple plans for solo TCs and teams.</h2>
            <p className="text-slate-400">Try Relay free and see how it fits into your workflow. Upgrade when you need more agents, custom templates, or team features.</p>
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
        <p className="text-xs text-slate-500 mt-6">The agent portal is free on every plan. Agents never need their own Relay subscription.</p>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <h2 className="font-display text-3xl font-semibold text-slate-100">Run your next closing in Relay.</h2>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/auth?mode=signup&plan=starter"
              className="inline-block px-8 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition"
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
            <Link href="/pricing" className="hover:text-slate-200 transition">Pricing</Link>
            <Link href="/faq" className="hover:text-slate-200 transition">FAQ</Link>
            <Link href="/for-agents" className="hover:text-slate-200 transition">For Agents</Link>
            <Link href="/auth" className="hover:text-slate-200 transition">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
