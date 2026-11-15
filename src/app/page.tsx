'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PUBLIC_PLANS } from '@/lib/plans';
import { decodeStoredRole } from '@/lib/authClient';
import DemoRequestButton from '@/components/DemoRequestButton';
import ShotRow from '@/components/ShotRow';
import HomeVideo from '@/components/HomeVideo';
import PublicMobileMenu from '@/components/PublicMobileMenu';
import { DealFlowIllustration, AutomationFlowIllustration, PayFlowIllustration, TemplateSharingIllustration, AutomationAudiencesIllustration } from '@/components/marketing/Illustrations';

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
      <header className="border-b border-slate-700">
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

      <section id="how-it-works" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <ShotRow
          name="intake-illustration.jpg"
          alt="Illustration of uploading a purchase contract in Relay and reviewing the address, price, key dates and people read from it before creating the transaction"
          caption="Illustration of the workflow."
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">AI contract intake</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Start with the contract, not a blank transaction.</h2>
          <p className="text-slate-400 mb-5">Upload a purchase contract or a listing agreement and AI fills out and creates the transaction or listing for you. Check the information, make any changes, and save. Templates and automations then handle the routine emails and reminders.</p>
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
        <ShotRow
          name="listings-illustration.jpg"
          alt="Illustration of a Relay listing with a pre-listing checklist, a side-by-side offer comparison, showings, documents, and a one-click convert to deal"
          caption="Illustration of the workflow."
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Listings</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Start before the contract.</h2>
          <p className="text-slate-400 mb-5">Track a listing from the first call to going live, through offers, to a signed contract. When it goes under contract, convert it to a transaction in one click and nothing gets retyped.</p>
          <ul className="space-y-2.5 text-sm text-slate-300">
            {[
              "A pre-listing checklist you can rename, reorder and mark done in one click",
              "Offers and counteroffers in one place, with terms read from the offer PDF and a side-by-side comparison",
              "Showings, open houses and buyer feedback, ready for your seller updates",
              "Listing agreement, disclosures and photos in a Documents card, copied onto the deal when you convert",
              "Price history, a ready-to-list check, and offer emails forwarded to the listing’s own address",
              "Convert to a deal: the checklist, documents and contacts carry over and your agent is told it is now active",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                {line}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500 mt-4">Included on every plan. Duplicate-address warnings keep the same property from being added twice.</p>
        </ShotRow>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <ShotRow
          name="transaction-illustration.jpg"
          alt="Illustration of a Relay transaction page with tabs for the checklist, documents, messages and contacts, plus key dates and the invoice"
          caption="Illustration of the workflow."
          reverse
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">The transaction workspace</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Every deal gets its own page.</h2>
          <p className="text-slate-400 mb-5">
            Open a transaction and everything for that deal is right there, from the checklist
            and documents to the messages, contacts, and invoice.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              'Checklist',
              'Critical dates',
              'Documents',
              'Signatures',
              'Messages',
              'Contacts',
              'Invoice',
              'Payment status',
            ].map((line) => (
              <div key={line} className="flex items-center gap-3 p-3 bg-slate-800/60 border border-slate-700 rounded-xl">
                <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                <span className="text-sm text-slate-300">{line}</span>
              </div>
            ))}
          </div>
        </ShotRow>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <ShotRow
          name="checklist-illustration.jpg"
          alt="Illustration of a Relay transaction checklist with grouped steps, due dates, a progress bar, and a step waiting on title"
          caption="Illustration of the workflow."
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
          name="invoice-illustration.jpg"
          alt="Illustration of the Relay Invoices page with total invoiced, outstanding and received amounts and a list of paid, unpaid and overdue invoices"
          caption="Illustration of the workflow."
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

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <ShotRow
          name="calendar-illustration.jpg"
          alt="Illustration of Relay dates on a calendar with Add to Google Calendar, Outlook and Apple Calendar buttons and a private calendar link" reverse
          caption="Illustration of the workflow."
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Calendar</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Your deadlines, on the calendar you already use.</h2>
          <p className="text-slate-400 mb-5">Connect Google Calendar once and every date you add or move in Relay updates there within seconds. Use Outlook or Apple Calendar? Subscribe to your private Relay link instead. Agents can connect their own calendar too, so every deal they are on shows up automatically.</p>
          <ul className="space-y-2.5 text-sm text-slate-300">
            {[
              "Connect Google Calendar in about 30 seconds and changes appear within seconds",
              "Outlook or Apple Calendar: add your private Relay link, no sign-in needed",
              "Critical dates, checklist due dates and listing dates, kept up to date as they change",
              "Choose what goes on your calendar: critical dates, closing day, checklist due dates, listing dates",
              "A private link only you have, which you can replace any time",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                {line}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500 mt-4">Subscribed links (Outlook, Apple, or Google by link) refresh on the calendar app's own schedule, so a change can take a few hours to show. Connecting Google Calendar directly avoids that wait.</p>
        </ShotRow>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <ShotRow
          name="import-illustration.jpg"
          alt="Illustration of importing deals from a CSV with column matching and a preview, next to a contacts list that fills itself"
          caption="Illustration of the workflow."
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Bring your work with you</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Move over in an afternoon.</h2>
          <p className="text-slate-400 mb-5">Import your open deals from a spreadsheet, and let Relay build your address book as you work.</p>
          <ul className="space-y-2.5 text-sm text-slate-300">
            {[
              "CSV deal import with automatic column matching and a preview before anything is created",
              "Re-importing the same file updates existing deals instead of duplicating them",
              "A contacts list that fills itself from your deals, with CSV import, export and a newsletter list",
              "Contacts and agents with phone numbers formatted automatically",
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
          name="invoicing-illustration.jpg"
          alt="Illustration of downloading Relay invoices as QuickBooks import files and uploading a QuickBooks export with every match shown before saving"
          caption="Illustration of the workflow."
          reverse
        >
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Invoicing</p>
          <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Your invoices, in QuickBooks in minutes.</h2>
          <p className="text-slate-400 mb-5">Download your Relay invoices as a file QuickBooks Online imports, or upload an export from QuickBooks to bring invoices into Relay. Nothing to connect and no permissions to grant, so you stay in control.</p>
          <ul className="space-y-2.5 text-sm text-slate-300">
            {[
              "Invoices in QuickBooks’ own column layout, split into files of 100 to match its import limit",
              "A payments report and your agents as a customer list, so the invoices land on the right customers",
              "Upload an Excel or CSV export from QuickBooks and see every match to an agent and deal before anything is saved",
              "Duplicates are skipped and existing invoices are never changed",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                {line}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500 mt-4">Included on every plan. This works by file: it does not connect to your QuickBooks account or sync on its own, and QuickBooks cannot import payment status from a file.</p>
        </ShotRow>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Everything you need to run the deal</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">Six things, done well. The rest is inside the app.</p>
        <DealFlowIllustration />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-8">
          {[
            { title: "Contracts, read for you", body: 'Upload a contract and AI fills out and creates the transaction or listing for you.' },
            { title: "Dates and checklists", body: 'Critical dates, a dated checklist and reminders on every deal. Sync to your calendar.' },
            { title: "Templates and automations", body: 'Ready-made emails and forms on every plan. Automations send the reminders for you on Pro and Team.' },
            { title: "Listings and transactions", body: 'Each has its own page. Convert a listing to a transaction in one click.' },
            { title: "Invoices and e-signatures", body: 'Invoice agents, get paid, export to QuickBooks, and send documents for signature.' },
            { title: "Teams and agent logins", body: 'Share a workspace with other TCs, and give agents a login for the deals you choose.' },
          ].map((f) => (
            <div key={f.title} className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
              <h3 className="font-semibold text-slate-100 mb-2">{f.title}</h3>
              <p className="text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-5 mt-8">
          <div>
            <p className="text-sm text-slate-400 mb-3">Templates: for TCs, agents and brokerages. A brokerage shares one with every agent.</p>
            <TemplateSharingIllustration />
          </div>
          <div>
            <p className="text-sm text-slate-400 mb-3">Automations: for TCs and for agents.</p>
            <AutomationAudiencesIllustration />
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-5 mt-8">
          <div>
            <p className="text-sm text-slate-400 mb-3">Automations: a reminder that sends itself.</p>
            <AutomationFlowIllustration />
          </div>
          <div>
            <p className="text-sm text-slate-400 mb-3">Invoices: from the deal to paid to your books.</p>
            <PayFlowIllustration />
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="flex items-end justify-between mb-12 flex-wrap gap-4">
          <div>
            <h2 className="font-display text-3xl font-semibold text-slate-100 mb-2">Simple plans for TCs and teams.</h2>
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
