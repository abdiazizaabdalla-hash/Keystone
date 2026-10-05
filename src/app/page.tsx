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
            Relay gives transaction coordinators one place to turn a signed contract into a
            structured deal, manage deadlines and documents, collaborate with agents, and get paid.
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
          alt="Reviewing the property, price, dates, and contacts Relay extracted from an uploaded purchase contract, before creating the transaction"
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">AI contract intake</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Start with the contract, not a blank transaction.</h2>
          <p className="text-slate-400 mb-5">Upload the signed purchase contract and Relay pulls the information needed to start the file. Review everything before creating the transaction, then start with the deal already populated. Included on every plan.</p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-slate-300">
            {[
              "Property address and purchase price",
              "Acceptance and closing dates",
              "Buyers, sellers, lender, and title contacts",
              "Agent matched to an existing profile",
              "Editable review before anything is created",
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
          name="transaction-workspace.jpg"
          alt="A full transaction workspace in Relay showing status, price, key dates, checklist progress, documents, and messages together"
          reverse
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">The transaction workspace</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">One transaction. Everything attached to it.</h2>
          <p className="text-slate-400 mb-5">Relay brings the checklist, deadlines, documents, conversations, contacts, and invoice together around the transaction they belong to.</p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-slate-300">
            {[
              "Status, price, and key dates up front",
              "Checklist with progress tracking",
              "Documents organized by category",
              "Messages between you and the agent",
              "Contacts for everyone on the deal",
              "The invoice, generated from the deal",
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
          name="checklist.jpg"
          alt="A transaction checklist in Relay with steps like Contract & File Setup and Inspection & Repairs, each with a due date and completion status"
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Workflow</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Know what needs to happen next.</h2>
          <p className="text-slate-400 mb-5">Every transaction starts with a closing workflow. Track each step, set due dates, and see what is complete, upcoming, or overdue without digging through email or spreadsheets.</p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-slate-300">
            {[
              "A baseline closing checklist on every deal",
              "Due dates from the acceptance date, the closing date, or a fixed date",
              "Dates recalculate automatically when a date changes",
              "Progress tracked at a glance",
              "Overdue and upcoming steps flagged",
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
          name="template-builder.jpg"
          alt="The checklist template builder in Relay, with a Cash Purchase template, its steps, and per-step deadline rules"
          reverse
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Custom workflows - Pro and Team</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Use your workflow, not someone else’s.</h2>
          <p className="text-slate-400 mb-5">Start with Relay’s baseline workflow or build templates around the deals you actually run: cash, financed, new construction, or your own process.</p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-slate-300">
            {[
              "Add and remove steps",
              "Reorder steps",
              "Set a deadline rule on each step",
              "Flag steps as required",
              "Save a template for each deal type",
              "Apply a template to a new transaction",
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
          name="document-setup.jpg"
          alt="Documents on a transaction in Relay, organized into categories like Contract & Disclosures, Inspection & Repairs, and Title & Escrow"
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Documents</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Keep every file where it belongs.</h2>
          <p className="text-slate-400 mb-5">Upload documents into organized categories and optionally link each one to the checklist step it supports. Contracts, disclosures, inspection reports, title files, amendments, and closing documents stay together with the deal.</p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-slate-300">
            {[
              "Categories from contract through post-closing",
              "Link a file to its checklist step",
              "See which documents still need a signature",
              "Downloads through short-lived, signed links",
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
          name="esign-request.jpg"
          alt="Sending a document for signature from a transaction in Relay, and the signature status shown on the document"
          reverse
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">E-signatures</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Sign without leaving the transaction.</h2>
          <p className="text-slate-400 mb-5">Send a document to the person who needs to sign using a secure link, track its status in Relay, or record a document as signed outside Relay.</p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-slate-300">
            {[
              "Secure signing link, no separate DocuSign account",
              "Signature status shown on the document",
              "Mark a document signed outside Relay",
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
          caption="One deal, one shared workspace."
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Agent portal</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Give agents visibility without giving them control.</h2>
          <p className="text-slate-400 mb-6">
            Every invited agent gets a free portal to follow their deals, exchange documents, and
            message you, without access to your other clients or your billing. One login works
            across every TC they work with.
          </p>
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-slate-200 mb-3">Agents can</p>
              <ul className="space-y-2.5 text-sm text-slate-300">
            {[
              "See transaction status and dates",
              "View checklist progress",
              "Upload documents and mark them signed",
              "Message you with file attachments",
              "Add a contact they know about",
              "View their invoices",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                {line}
              </li>
            ))}
          </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200 mb-3">Agents can&apos;t</p>
              <ul className="space-y-2.5 text-sm text-slate-300">
            {[
              "Check off your checklist",
              "Send or void signature requests",
              "Delete documents or edit contacts",
              "See your other clients",
              "See your billing",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                {line}
              </li>
            ))}
          </ul>
            </div>
          </div>
          <Link
            href="/for-agents"
            className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 font-medium transition mt-6"
          >
            Are you an agent? See what you can do &rarr;
          </Link>
        </ShotRow>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <ShotRow
          name="agent-conversation.jpg"
          alt="An agent’s view of a transaction in Relay, mid-conversation with their TC about an inspection report and a requested repair credit"
          reverse
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Messaging</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Stop chasing updates over text.</h2>
          <p className="text-slate-400 mb-5">Keep the conversation attached to the deal it belongs to. Agents and TCs can exchange messages and files right on the transaction, without searching through text threads or email chains.</p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-slate-300">
            {[
              "A conversation thread on every deal",
              "File attachments on messages",
              "Forward or CC emails to the deal so they land on it too",
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
          name="invoice.jpg"
          alt="An invoice generated from a transaction in Relay, showing the fee, due date, payment status, and pay link"
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Invoicing</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Finish the deal. Send the invoice. Get paid.</h2>
          <p className="text-slate-400 mb-5">Generate the invoice from the transaction when the deal closes, send it to the agent, and track payment status, with every agent’s fee and payment history kept together.</p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-slate-300">
            {[
              "Invoice generated from the transaction",
              "Sent to the agent by email",
              "Agents pay through your connected Stripe account",
              "Or mark it paid however they actually paid you",
              "Payment status on every deal",
              "Fee and payment history per agent",
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
          name="daily-digest.jpg"
          alt="A Relay daily digest email listing overdue and due-today checklist steps across transactions"
          reverse
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Daily digest</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Start the day knowing what needs attention.</h2>
          <p className="text-slate-400 mb-5">Relay emails you a daily digest of checklist steps that are overdue or due today, and your dashboard gives you the same triage across every open transaction, so you hear about it before an agent has to ask.</p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-slate-300">
            {[
              "Overdue and due-today steps in one email",
              "A dashboard view across every open deal",
              "Items waiting on someone else",
              "Closings coming up soon",
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
          name="team-dashboard.jpg"
          alt="The team view in Relay, showing the shared team roster and each coordinator’s transactions"
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Solo and teams</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Built for solo TCs. Ready for teams.</h2>
          <p className="text-slate-400 mb-5">Run Relay on your own, or give your team a shared workspace. Everyone works their own files, and the team owner can see every member’s transactions and documents.</p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm text-slate-300">
            {[
              "A shared team roster",
              "Owner visibility into every member’s files",
              "A shared agent roster across the team",
              "Team-wide checklist templates",
              "$19 per coordinator seat, 3-seat minimum",
              "Agents never need a paid seat",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                {line}
              </li>
            ))}
          </ul>
        </ShotRow>
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
        <p className="text-center text-xs text-slate-500 mt-6">The agent portal is free on every plan — agents you invite never need a Relay subscription of their own.</p>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-6">Run your next closing in Relay.</h2>
        <div className="flex flex-wrap items-center justify-center gap-4">
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
