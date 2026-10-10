'use client';

import Link from 'next/link';
import PublicMobileMenu from '@/components/PublicMobileMenu';

const FEATURES: { title: string; body: string }[] = [
  {
    title: 'See the checklist',
    body: 'Watch the deal move from contract to closing in real time -- every step, every due date, exactly as your TC sees it. View-only, so you always know where things stand without having to ask.',
  },
  {
    title: 'Documents, organized',
    body: 'Upload contracts, disclosures, and inspection reports straight into the right category, or grab anything your TC has already added. No digging through email threads for the latest version.',
  },
  {
    title: 'Message your TC directly',
    body: 'A real conversation thread on the deal itself, with file attachments -- not another text chain or inbox to check. Right on the transaction, from either side.',
  },
  {
    title: 'Get paid without the back-and-forth',
    body: 'Once your TC generates your invoice, see the amount, due date, and status right on the deal -- and pay it in a couple of clicks through a secure Stripe link, no invoice email to hunt down.',
  },
  {
    title: 'Add the contacts you know',
    body: "Loop in a lender or an inspector by adding them as a contact on the deal. Your TC keeps control of anything already there -- you can add, not edit or remove what's not yours.",
  },
  {
    title: 'One login, every TC',
    body: "Work with more than one coordinator? The same login follows you. Every deal from every TC who's invited you shows up in one place, grouped by who you're working with.",
  },
];

export default function ForAgentsPage() {
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
            <Link href="/pricing" className="hover:text-slate-100 transition">Pricing</Link>
            <Link href="/faq" className="hover:text-slate-100 transition">FAQ</Link>
            <Link href="/for-agents" className="text-slate-100">For Agents</Link>
          </nav>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/agent/login"
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full border border-blue-500/40 bg-blue-500/10 text-sm text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 transition whitespace-nowrap"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              <span className="sm:hidden">Agent</span>
              <span className="hidden sm:inline">Agent Login</span>
            </Link>
            <Link href="/auth" className="text-sm text-slate-300 hover:text-slate-100 transition whitespace-nowrap">Sign In</Link>
            <Link
              href="/auth?mode=signup&plan=starter"
              className="px-3 sm:px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition whitespace-nowrap"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">For Agents</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Your TC uses Relay. Here&apos;s what that gets you.
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
          A free login to every deal you&apos;re working -- the checklist, the documents, a direct
          line to your TC, and your invoice, all in one place. No credit card, no subscription,
          nothing to set up on your own.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/agent/login"
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10"
          >
            Log in as an agent
          </Link>
          <Link
            href="#features"
            className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition"
          >
            See what you get
          </Link>
        </div>
        <p className="text-xs text-slate-500 mt-5">
          Don&apos;t have a login yet? Your TC invites you by email the first time they add you to a deal.
        </p>
      </section>

      {/* Screenshot */}
      <section className="max-w-3xl mx-auto px-6 pb-20">
        <div className="rounded-xl border border-slate-700 overflow-hidden shadow-2xl bg-slate-800">
          <img
            src="/screenshots/agent-full-view.jpg"
            alt="An agent's view of a transaction in Relay: documents organized by category, a message thread with the TC, checklist progress, and contacts, all on one page"
            className="w-full h-auto block"
          />
        </div>
        <p className="text-xs text-slate-500 mt-3 text-center">Everything for one deal, on one page</p>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 pb-20 scroll-mt-20">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4 text-center">What you can do</h2>
        <p className="text-slate-400 mb-12 max-w-2xl mx-auto text-center">
          Everything below is included the moment a TC invites you -- free, for as many TCs and deals as you work.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <div key={f.title} className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
              <h3 className="font-semibold text-slate-100 mb-2">{f.title}</h3>
              <p className="text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Boundaries */}
      <section className="max-w-4xl mx-auto px-6 pb-20 border-t border-slate-700 pt-16">
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-4 text-center">What stays with your TC</h2>
        <p className="text-slate-400 max-w-2xl mx-auto text-center mb-8">
          Relay keeps the line clear between what you can see and do, and what&apos;s your TC&apos;s to manage.
        </p>
        <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm text-slate-300 max-w-2xl mx-auto">
          {[
            "Checking off checklist steps -- you can see progress, not mark it done",
            'Sending signature requests -- you can mark something signed outside Relay',
            "Editing or removing a contact someone else added",
            "Any other client, deal, invoice, or billing detail of your TC's",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <svg className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              {line}
            </li>
          ))}
        </ul>
      </section>

      {/* Getting started */}
      <section className="max-w-4xl mx-auto px-6 pb-24 border-t border-slate-700 pt-16">
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-8 text-center">Getting started takes one email</h2>
        <div className="grid sm:grid-cols-3 gap-8 text-center">
          {[
            { step: '1', title: 'Your TC invites you', body: 'They add you to a deal and Relay emails you a link -- no action needed until then.' },
            { step: '2', title: 'Click the link, you’re in', body: 'No password required to start. Set one later if you’d rather not use email links every time.' },
            { step: '3', title: 'Log in anytime', body: 'The same email works for every TC who invites you -- all your deals, one login, relaytc.com/agent/login.' },
          ].map((s) => (
            <div key={s.step}>
              <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/40 text-blue-300 font-semibold flex items-center justify-center mx-auto mb-4">
                {s.step}
              </div>
              <h3 className="font-semibold text-slate-100 mb-2">{s.title}</h3>
              <p className="text-sm text-slate-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 pb-24 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Already have an invite waiting?</h2>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/agent/login"
            className="inline-block px-8 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition"
          >
            Log in as an agent
          </Link>
          <Link href="/pricing" className="px-8 py-3 border border-slate-600 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">
            I&apos;m a TC -- see plans
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
