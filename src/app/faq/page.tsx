'use client';

import { useState } from 'react';
import Link from 'next/link';

const FAQS: { category: string; q: string; a: string }[] = [
  // Getting started
  {
    category: 'Getting started',
    q: 'Who is Relay TC for?',
    a: 'Transaction coordinators and real estate agents who manage the paperwork and checklist between an accepted contract and closing day — solo TCs, brokerage support staff, and small teams, plus the agents they work with.',
  },
  {
    category: 'Getting started',
    q: 'What happens when I create a new transaction?',
    a: 'Relay automatically builds a standard closing checklist (Contract & File Setup, Earnest Money & Option, Inspection & Repairs, Title/Appraisal & Financing, Clear to Close, Closing & Post-Closing) so you’re not starting from a blank page on every deal, with each step’s due date computed off your acceptance and closing dates. Pro and Team accounts can also build their own custom checklist templates, with their own steps, due-date rules, and required-step flags.',
  },
  {
    category: 'Getting started',
    q: 'Can Relay fill in a new transaction from the contract itself?',
    a: 'Yes. Upload the signed purchase contract when creating a transaction and Relay reads it: property address, purchase price, acceptance and closing dates, buyers, sellers, the lender, and the title/escrow contact all come back pre-filled, and matching parties get added to the transaction as contacts automatically. Everything lands in an editable form first, so you review and adjust before it’s actually saved. Available on every plan, including Starter.',
  },
  {
    category: 'Getting started',
    q: 'Can I upload documents to a transaction?',
    a: 'Yes. Upload PDFs, images, or other files into any document category, optionally linked to the checklist step they belong to. Files are stored securely and downloaded through short-lived, signed links rather than public URLs.',
  },
  {
    category: 'Getting started',
    q: 'What if I delete a transaction, agent, or invoice by mistake?',
    a: 'Each has a delete option with a confirmation step first. Deleting a transaction also removes its checklist, uploaded documents, and any invoice generated from it, so you don’t end up with orphaned records.',
  },
  // Pricing & billing
  {
    category: 'Pricing & billing',
    q: 'What’s included on the free Starter plan?',
    a: 'Starter includes unlimited transactions, up to 3 agent profiles, the baseline checklist, document storage, e-signature requests, invoicing, and the free agent portal — enough to run your whole pipeline through Relay with no credit card required to start.',
  },
  {
    category: 'Pricing & billing',
    q: 'What happens when my trial ends?',
    a: 'Starter includes a free trial that lasts 30 days or until your first paid deal closes, whichever comes first. Once the trial ends, Starter continues at $10/month — you’ll need to add a payment method to keep creating and editing transactions, agents, documents, and invoices. Nothing is deleted if you don’t upgrade right away; you just can’t make new changes until you do.',
  },
  {
    category: 'Pricing & billing',
    q: 'Does Starter have a transaction limit?',
    a: 'No. Every plan, including Starter, supports unlimited transactions. The only caps on Starter are 3 agent profiles and no custom checklist templates.',
  },
  {
    category: 'Pricing & billing',
    q: 'What’s the difference between Starter and Pro?',
    a: 'Pro removes the agent-profile limit entirely, unlocks custom checklist templates, and adds the admin usage dashboard. Everything else — the checklist, documents, e-signatures, invoicing, and the agent portal — works the same on both.',
  },
  {
    category: 'Pricing & billing',
    q: 'How does Team billing work?',
    a: 'Team is billed per seat at $19/month, with a three-seat minimum ($57/month to start). Adding a teammate beyond your paid seats charges the difference immediately; removing one credits your next invoice. Seats are for the people coordinating transactions — agents you invite through the agent portal never need a paid seat.',
  },
  {
    category: 'Pricing & billing',
    q: 'Can I change plans later?',
    a: 'Yes, from your dashboard. Upgrading takes effect immediately; nothing about your existing transactions, agents, or invoices changes when you switch plans.',
  },
  {
    category: 'Pricing & billing',
    q: 'What happens to my data if I stop paying?',
    a: 'Your account and data stay in place. Features tied to a paid plan apply again if you upgrade later — nothing is deleted for downgrading.',
  },
  // Agent portal
  {
    category: 'Agent portal',
    q: 'Do the agents I work with need their own Relay account?',
    a: 'Not to be billed — you create an agent profile with their fee structure and contact details for invoicing, and that never requires a login. But you can separately invite an agent to a specific transaction for free, which gives them their own portal login scoped to just that deal. These are two different things that happen to share the word “agent”: an agent profile is a billing contact, while an invited agent is an actual login with access to one transaction.',
  },
  {
    category: 'Agent portal',
    q: 'How do I invite an agent?',
    a: 'From a transaction’s page, enter the agent’s email and send the invite. They get a magic-link email — no password needed the first time — and set one up on their very first login. Access to that transaction only takes effect once they click the link.',
  },
  {
    category: 'Agent portal',
    q: 'Can one agent work with multiple TCs?',
    a: 'Yes. An agent’s portal login is their own — if several different TCs invite the same agent to their own deals, that agent sees every one of them grouped by TC in a single dashboard.',
  },
  {
    category: 'Agent portal',
    q: 'What can agents see and change?',
    a: 'An invited agent can view the checklist, dates, and status (read-only), upload documents and mark them signed or unsigned, add a new transaction contact, and message you with file attachments. They cannot check off checklist items, delete a document, send or void a signature request, or edit or remove a contact — including ones they added themselves.',
  },
  {
    category: 'Agent portal',
    q: 'Can agents access other clients’ transactions?',
    a: 'No. An agent only ever sees the specific transactions they’ve been individually invited to — never your other clients, your invoices, or your billing.',
  },
  {
    category: 'Agent portal',
    q: 'Can agents sign documents through Relay?',
    a: 'Agents can mark a document as signed or unsigned, the same toggle you have. Actually sending a document out for signature — or canceling a pending request — stays with the TC.',
  },
  // Documents & signatures
  {
    category: 'Documents & signatures',
    q: 'What file types and sizes can I upload?',
    a: 'Any common file type, up to 25MB per file, filed under whichever document category fits best.',
  },
  {
    category: 'Documents & signatures',
    q: 'How do e-signature requests work?',
    a: 'Pick an existing PDF and send it out — Relay emails the signer a secure link, good for 14 days, with no account required on their end. They can type or draw their signature, and Relay appends a signed certificate page with their name, timestamp, and IP address, saving the result as a new document.',
  },
  {
    category: 'Documents & signatures',
    q: 'Can I upload documents signed elsewhere?',
    a: 'Yes — upload the already-signed file and mark it Signed by hand. You don’t need to route everything through Relay’s own signature flow.',
  },
  {
    category: 'Documents & signatures',
    q: 'What happens to the original document after signing?',
    a: 'The signed copy is saved as a new document, and the original stays in your records too, so you always have both.',
  },
  // Invoicing & payments
  {
    category: 'Invoicing & payments',
    q: 'Are invoices generated automatically?',
    a: 'No — you create the invoice yourself from the transaction page whenever you’re ready, even after the deal closes. The commission math (flat fee plus any percentage of the purchase price) is calculated for you from the agent’s saved settings, so you’re never doing that part by hand.',
  },
  {
    category: 'Invoicing & payments',
    q: 'Does Relay collect my invoice payments?',
    a: 'No. If you connect a Stripe account, your agent pays directly into your own Stripe balance — Relay charges no platform fee and never holds the money.',
  },
  {
    category: 'Invoicing & payments',
    q: 'How do I connect Stripe?',
    a: 'From Settings, under “Getting Paid by Agents,” choose Stripe Connect and complete Stripe’s own short onboarding. Once approved, every invoice can include a live payment link.',
  },
  {
    category: 'Invoicing & payments',
    q: 'Can I accept Zelle or other external payments?',
    a: 'Yes — choose “Handle it yourself” instead of Stripe Connect, and mark invoices paid manually once you’ve been paid however you actually collect money.',
  },
  {
    category: 'Invoicing & payments',
    q: 'Can I issue refunds through Relay?',
    a: 'Refunds are issued from your own Stripe dashboard; Relay reflects the refund on the invoice automatically once Stripe reports it.',
  },
  // Teams
  {
    category: 'Teams',
    q: 'What does the Team plan include?',
    a: 'Everything in Pro, plus a shared team roster, owner visibility into every member’s transactions and documents, and team-wide access to checklist templates — billed per TC seat, three-seat minimum.',
  },
  {
    category: 'Teams',
    q: 'Can team members see each other’s transactions?',
    a: 'Only the team owner sees everyone’s work. A regular member sees their own transactions and agents, plus the team roster itself, but not a teammate’s pipeline.',
  },
  {
    category: 'Teams',
    q: 'What happens if the owner cancels?',
    a: 'The whole team unwinds — every member reverts to Starter, and the shared team workspace is dissolved. If an individual member’s own account is downgraded instead, only their membership ends; the team continues for everyone else.',
  },
];

const CATEGORIES = Array.from(new Set(FAQS.map((f) => f.category)));

export default function FAQPage() {
  const [openQ, setOpenQ] = useState<string | null>(FAQS[0].q);

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

      {/* Header */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-12 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">FAQ</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Questions, answered.
        </h1>
        <p className="text-lg text-slate-400">Everything you need to know before you bring Relay into your workflow.</p>
      </section>

      {/* Accordion, grouped by category */}
      <section className="max-w-3xl mx-auto px-6 pb-24">
        {CATEGORIES.map((category) => (
          <div key={category} className="mb-10">
            <h2 className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">{category}</h2>
            <div className="divide-y divide-slate-700 border-t border-b border-slate-700">
              {FAQS.filter((item) => item.category === category).map((item) => {
                const isOpen = openQ === item.q;
                return (
                  <div key={item.q}>
                    <button
                      onClick={() => setOpenQ(isOpen ? null : item.q)}
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
          </div>
        ))}
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
            <Link href="/for-agents" className="hover:text-slate-200 transition">For Agents</Link>
            <Link href="/auth" className="hover:text-slate-200 transition">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
