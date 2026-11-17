'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { decodeStoredRole } from '@/lib/authClient';
import DemoRequestButton from '@/components/DemoRequestButton';
import PublicHeader from '@/components/PublicHeader';
import { HeroWorkspaceMockup, ProblemContrastMockup, ContractIntakeMockup, InvoiceMockup, CommissionStatementMockup, TransactionWorkspaceMockup, ListingDashboardMockup, WorkflowBuilderMockup, BrokerageDashboardMockup, ConnectedMockup, AgentMini, CoordinatorMini, BrokerageMini, MockupCaption } from '@/components/marketing/ProductMockups';

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
      <PublicHeader />

      {/* 1. Hero */}
      <section className="max-w-7xl mx-auto px-6 pt-16 pb-20 grid lg:grid-cols-[4fr_6fr] gap-12 items-center">
        <div>
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-5">Transactions, listings and brokerage oversight</p>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-slate-100 leading-[1.08] mb-6">
            Every transaction. Every listing. <span className="text-blue-400">One platform.</span>
          </h1>
          <p className="text-lg text-slate-400 mb-8 max-w-lg">
            Manage transactions, listings, clients, documents and workflows in one place. Upload a purchase or listing contract and Relay builds the file for you, with no retyping. For agents, transaction coordinators and brokerages.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/get-started" className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10">Get started</Link>
            <a href="#platform" className="px-6 py-3 border border-slate-700 hover:border-slate-500 text-slate-200 font-semibold rounded-lg transition">Explore the platform</a>
          </div>
          <p className="text-xs text-slate-500 mt-4">Free for 14 days. No credit card required.</p>
          <nav aria-label="Choose your role" className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <a href="#agents" className="text-slate-300 hover:text-white transition">For agents</a>
            <span className="text-slate-700">|</span>
            <a href="#coordinators" className="text-slate-300 hover:text-white transition">For transaction coordinators</a>
            <span className="text-slate-700">|</span>
            <a href="#brokerages" className="text-slate-300 hover:text-white transition">For brokerages</a>
          </nav>
        </div>
        <div><HeroWorkspaceMockup /></div>
      </section>

      {/* AI contract intake */}
      <section id="contract-intake" className="max-w-7xl mx-auto px-6 py-20 border-t border-slate-700 scroll-mt-20">
        <div className="max-w-3xl mb-12">
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">AI contract intake</p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-slate-100 mb-4">Upload the contract. Your workspace builds itself.</h2>
          <p className="text-slate-400">Skip the retyping. Upload a purchase contract or a listing agreement and Relay creates the transaction or listing for you: the property, the price, every key date, and the people on the deal, already added as contacts.</p>
        </div>
        <ContractIntakeMockup />
        <MockupCaption>Illustration of contract intake. Names, addresses and numbers are made up.</MockupCaption>
        <div className="grid md:grid-cols-3 gap-5 mt-12">
          {[
            ['1', 'Upload', 'Add the executed purchase contract, or the signed listing agreement, from your computer.'],
            ['2', 'Relay fills it in', 'Property, price, parties, earnest money, inspection, appraisal, financing and closing dates, plus lender and title contacts when the contract names them.'],
            ['3', 'You review and save', 'Check what was read, fix anything, and save. Your checklist, dates and documents are ready on the deal.'],
          ].map(([n, t, b]) => (
            <div key={n} className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
              <span className="w-8 h-8 rounded-full bg-blue-500 text-white text-sm font-semibold flex items-center justify-center mb-4">{n}</span>
              <h3 className="font-semibold text-slate-100 mb-1.5">{t}</h3><p className="text-sm text-slate-400">{b}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-4">Upload the contract as a PDF. Relay flags anything unclear for you to check, and nothing is saved until you review it.</p>
      </section>

      {/* 2. The problem */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="max-w-3xl mb-10">
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">The problem</p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-slate-100 mb-4">Your real estate operation shouldn’t live across five different tools.</h2>
          <p className="text-slate-400">Disconnected systems create extra administrative work, missed details and inconsistent processes. Deals sit in spreadsheets, deadlines in calendars, contacts in lists and documents in folders, while brokerage leaders lack a view of what agents are doing. Relay puts it in one organized workspace.</p>
        </div>
        <ProblemContrastMockup />
      </section>

      {/* 3. One platform, three ways to work */}
      <section id="platform" className="max-w-7xl mx-auto px-6 py-20 border-t border-slate-700 scroll-mt-20">
        <div className="max-w-3xl mb-10">
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">One platform, three ways to work</p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-slate-100 mb-4">Built for everyone involved in the transaction.</h2>
          <p className="text-slate-400">The same Relay workspace underneath. What changes is who is using it and what they can see.</p>
        </div>
        <div className="grid lg:grid-cols-3 gap-6">
          {[
            { id: 'agents', who: 'Agents', head: 'Run your business from one place.', body: 'Manage transactions, listings, contacts, documents and client communication without juggling disconnected systems.', cta: 'Explore Relay for agents', href: '/for-agents', art: <AgentMini />, price: 'Starter $19 · Pro $39 a month' },
            { id: 'coordinators', who: 'Transaction coordinators and teams', head: 'Manage every detail. Keep every deal moving.', body: 'Coordinate transactions, organize listings, automate repetitive tasks and run your coordination business, alone or as a team, from one workspace.', cta: 'Explore Relay for TCs', href: '/for-tcs', art: <CoordinatorMini />, price: 'Starter $19 · Pro $39 · Team $89 a month' },
            { id: 'brokerages', who: 'Brokerages', head: 'Equip your agents. Oversee your entire operation.', body: 'Give agents full Relay accounts, with brokerage-wide visibility, listing oversight, shared templates and standardized workflows for leadership.', cta: 'Explore Relay for brokerages', href: '/for-brokerages', art: <BrokerageMini />, price: 'From $99 a month, agents included' },
          ].map((c) => (
            <div key={c.id} id={c.id} className="scroll-mt-24 flex flex-col rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
              <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">{c.who}</p>
              <h3 className="font-display text-xl font-semibold text-slate-100 mb-2">{c.head}</h3>
              <p className="text-sm text-slate-400 mb-5">{c.body}</p>
              <div className="mb-5 mt-auto">{c.art}</div>
              <p className="text-xs text-slate-500 mb-3">{c.price}</p>
              <Link href={c.href} className="text-sm font-semibold text-blue-400 hover:text-blue-300">{c.cta} →</Link>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Transactions */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="max-w-3xl mb-12">
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Transaction management</p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-slate-100 mb-4">From contract to closing, everything stays connected.</h2>
          <p className="text-slate-400">Relay manages the work of a transaction, not just a list of them.</p>
        </div>
        <TransactionWorkspaceMockup />
        <MockupCaption />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-12">
          {[
            ['Contract intake', 'Upload a supported electronic contract and Relay reads the property, parties, price and key dates. You check and save.'],
            ['Tracking and milestones', 'Active transactions, progress and closing deadlines, with what needs attention at the top.'],
            ['Tasks and checklists', 'A closing checklist on every deal, with due dates that follow the contract and move when it does.'],
            ['Documents and e-signatures', 'Documents kept with the step they belong to, and signature requests with a record of who signed.'],
            ['Contacts', 'Agents, clients, lenders, title companies and inspectors, kept with the deals they work on.'],
            ['Client communication', 'Deal emails and a live progress page for your buyer or seller, showing only what you choose.'],
            ['Calendar sync', 'Critical dates on Google Calendar within seconds, or on Outlook and Apple by a private link.'],
            ['Invoicing and payments', 'Invoices alongside the deal, Stripe payments, and QuickBooks files.'],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
              <h3 className="font-semibold text-slate-100 mb-1.5">{t}</h3><p className="text-sm text-slate-400">{b}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-4">Contract intake reads PDF contracts. Results are always shown for your review before anything is saved.</p>
      </section>

      {/* 5. Listings */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="max-w-3xl mb-12">
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Listing management</p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-slate-100 mb-4">Your listings deserve the same level of organization.</h2>
          <p className="text-slate-400">Listings are a first-class part of Relay, with their own page, tools and templates. When an offer is accepted, one click turns the listing into a transaction.</p>
        </div>
        <ListingDashboardMockup />
        <MockupCaption />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-3 text-sm text-slate-300 mt-10">
          {['Property details and pricing', 'Listing and expiration dates', 'Offers and showings', 'Listing contacts and documents'].map((x) => (
            <li key={x} className="flex items-start gap-2.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />{x}</li>
          ))}
        </ul>
      </section>

      {/* 6. Automation */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="max-w-3xl mb-12">
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Workflow automation</p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-slate-100 mb-4">Stop repeating the work. Build workflows that move things forward.</h2>
          <p className="text-slate-400">Choose what triggers a workflow, such as a new transaction or an approaching closing date, then the steps that follow. Start from ready-made workflows or build your own, and choose whether Relay asks you before it sends anything.</p>
        </div>
        <WorkflowBuilderMockup />
        <MockupCaption>Illustration of the workflow builder. Names and steps are examples.</MockupCaption>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
          {['Create tasks when a transaction starts', 'Send reminders as a deadline approaches', 'Start closing preparation', 'Create listing tasks when a listing is added', 'Send follow-ups after key events', 'Pause everything with one switch'].map((x) => (
            <div key={x} className="rounded-xl border border-slate-700 bg-slate-800/50 px-5 py-4 text-sm text-slate-300">{x}</div>
          ))}
        </div>
      </section>

      {/* Invoicing, Stripe and QuickBooks */}
      <section id="get-paid" className="max-w-7xl mx-auto px-6 py-20 border-t border-slate-700 scroll-mt-20">
        <div className="max-w-3xl mb-10">
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Invoicing, Stripe and QuickBooks</p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-slate-100 mb-4">Run the whole business in one place, from the deal to the books.</h2>
          <p className="text-slate-400">Invoice or pay commissions through your own Stripe account, and export to QuickBooks when it is time to close the month. No retyping, no second system for money.</p>
        </div>
        <div className="space-y-8 mt-10">
        <div className="grid lg:grid-cols-2 gap-8 items-center">
          <InvoiceMockup />
        </div>
        <div className="grid lg:grid-cols-2 gap-8 items-center">
          <div className="lg:order-2">
          <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-7">
              <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-2">For coordinators</p>
              <h3 className="font-display text-xl font-semibold text-slate-100 mb-4">Invoice the agent, get paid, export.</h3>
              <ul className="space-y-3 text-sm text-slate-300">
                <li><span className="font-semibold text-slate-100">Invoice from the deal.</span> Create an invoice on the transaction, with your logo, and send it to the agent.</li>
                <li><span className="font-semibold text-slate-100">Get paid into your own Stripe.</span> Agents pay by card or bank through your connected Stripe account. The money goes to you, Relay takes no platform fee, and standard Stripe fees apply. You can also record Zelle or check payments.</li>
                <li><span className="font-semibold text-slate-100">Export to QuickBooks.</span> Download invoices, a payments report and your agents as CSV files QuickBooks Online can import.</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-7">
              <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-2">For brokerages</p>
              <h3 className="font-display text-xl font-semibold text-slate-100 mb-4">Statement, pay commission, export.</h3>
              <ul className="space-y-3 text-sm text-slate-300">
                <li><span className="font-semibold text-slate-100">Commission statements.</span> Commission is calculated from your splits, caps and deductions, and agents get a statement with your logo.</li>
                <li><span className="font-semibold text-slate-100">Pay through Stripe.</span> Agents connect their Stripe account, and you pay commissions from the statement through your own Stripe. Commission payouts through Relay are coming soon, and until then you record payments made the usual way.</li>
                <li><span className="font-semibold text-slate-100">Export to QuickBooks.</span> Export the commission ledger as CSV or QuickBooks bills.</li>
              </ul>
            </div>
          </div>
          <div className="lg:order-1"><CommissionStatementMockup /></div>
        </div>
        </div>
        <MockupCaption>Illustration of an invoice and a commission statement. Names and numbers are made up.</MockupCaption>
        <p className="text-xs text-slate-500 mt-4">Relay does not sync with QuickBooks on its own: you import the files you export.</p>
      </section>

      {/* 7. Brokerage advantage */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="max-w-3xl mb-12">
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">The brokerage advantage</p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-slate-100 mb-4">One platform for your agents. Complete visibility for your brokerage.</h2>
          <p className="text-slate-400">Every agent gets the tools to manage their own transactions and listings. Leadership gets a view across the organization, without opening every agent’s workspace.</p>
        </div>
        <BrokerageDashboardMockup />
        <MockupCaption>Illustration of the brokerage dashboard. Names and numbers are made up.</MockupCaption>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-12">
          {[
            ['Brokerage-wide oversight', 'Active deals, upcoming closings, late steps, listings and each agent’s progress in one place.'],
            ['Standardized workflows', 'Build a workflow once and publish it so agents run the same process.'],
            ['Shared templates', 'Share forms and email templates once. They appear in every agent’s template list.'],
            ['Agent management', 'Invite agents, manage seats and add managing accounts with scoped roles.'],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl border border-slate-700 bg-slate-800/50 p-5"><h3 className="font-semibold text-slate-100 mb-1.5">{t}</h3><p className="text-sm text-slate-400">{b}</p></div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-4">Brokerage leaders see where files stand and what is missing. Private messages and agents’ own contacts stay private.</p>
        <div className="flex flex-wrap items-center gap-4 mt-8">
          <DemoRequestButton className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition" label="Book a brokerage demo" />
          <Link href="/for-brokerages" className="px-6 py-3 border border-slate-700 hover:border-slate-500 text-slate-200 font-semibold rounded-lg transition">Explore brokerage features</Link>
        </div>
      </section>

      {/* 8. Connected */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="max-w-3xl mb-12">
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Everything connected</p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-slate-100 mb-4">Your tools, information and workflows work together.</h2>
          <p className="text-slate-400">Information entered once shows up wherever it is needed.</p>
        </div>
        <ConnectedMockup />
      </section>

      {/* 9. Benefits */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <h2 className="font-display text-3xl sm:text-4xl font-semibold text-slate-100 mb-10 max-w-3xl">Less administrative work. More visibility. Better-organized transactions.</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            ['Stay organized', 'Keep transactions, listings, documents, contacts and deadlines together.'],
            ['Work more efficiently', 'Automate repetitive tasks and standardize how your team works.'],
            ['Stay informed', 'See what needs attention and where every transaction stands.'],
          ].map(([t, b]) => (
            <div key={t} className="rounded-2xl border border-slate-700 bg-slate-800/50 p-7"><h3 className="font-display text-xl font-semibold text-slate-100 mb-2">{t}</h3><p className="text-slate-400">{b}</p></div>
          ))}
        </div>
      </section>


      {/* Pricing teaser */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-slate-700">
        <div className="flex items-end justify-between mb-10 flex-wrap gap-4">
          <div>
            <h2 className="font-display text-3xl font-semibold text-slate-100 mb-2">Simple pricing for every role.</h2>
            <p className="text-slate-400">Try Relay free and see how it fits. Pick the row that describes you.</p>
          </div>
          <Link href="/pricing" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
            Full pricing details →
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { who: 'Agents', price: '$19', note: 'a month, to start', extra: 'Pro is $39 a month, with automations', href: '/pricing#agents' },
            { who: 'Coordinators', price: '$19', note: 'a month, to start', extra: 'Pro adds automations and templates', href: '/pricing#coordinators' },
            { who: 'TC teams', price: '$89', note: 'a month, three seats', extra: '$30 a month for each extra seat', href: '/pricing#coordinators' },
            { who: 'Brokerages', price: '$99', note: 'a month, 10 agents', extra: 'Pro is $199 a month for 25 agents', href: '/pricing#brokerages' },
          ].map((p) => (
            <Link key={p.who} href={p.href} className="p-6 rounded-xl border border-slate-700 bg-slate-800/60 hover:border-blue-400/60 transition flex flex-col">
              <h3 className="font-semibold text-slate-100">{p.who}</h3>
              <p className="text-3xl font-display font-semibold text-slate-100 mt-2">{p.price}</p>
              <p className="text-sm text-slate-400">{p.note}</p>
              <p className="text-sm text-slate-300 mt-4">{p.extra}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* 10. Final conversion */}
      <section className="max-w-4xl mx-auto px-6 py-24 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl sm:text-4xl font-semibold text-slate-100 mb-4">Bring your entire real estate operation into Relay.</h2>
        <p className="text-slate-400 mb-8 max-w-2xl mx-auto">Whether you are managing your own transactions, coordinating deals for clients or overseeing a brokerage, Relay gives you the tools to keep everything moving.</p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/get-started" className="px-8 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10">Get started</Link>
          <DemoRequestButton className="px-7 py-3 border border-slate-700 hover:border-slate-500 text-slate-200 font-semibold rounded-lg transition" label="Book a demo" />
        </div>
        <p className="text-xs text-slate-500 mt-5">Agents and coordinators: start free for 14 days. Brokerages: book a demo or start a 30-day pilot.</p>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 bg-white rounded-md flex items-center justify-center p-1 shadow-sm">
              <img src="/relay-icon.png" alt="Relay" className="w-full h-full object-contain" />
            </span>
            <span className="font-brand font-extrabold text-sm text-slate-300">Relay</span>
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
