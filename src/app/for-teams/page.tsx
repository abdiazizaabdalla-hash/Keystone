'use client';

import Link from 'next/link';
import PublicMobileMenu from '@/components/PublicMobileMenu';
import DemoRequestButton from '@/components/DemoRequestButton';
import TeamsVideo from '@/components/TeamsVideo';

// Flip to true once /public/video/relay-tc-teams.mp4 and its poster are in place.
const TEAMS_VIDEO_READY = true;

const FEATURES: { title: string; body: string }[] = [
  {
    title: 'A team board and direct messages',
    body: 'One place for the whole team to talk: a team board everyone can read, plus one-to-one direct messages. Unread counts show on your Collaborate home so nothing gets missed.',
  },
  {
    title: 'Shared contacts',
    body: 'Share the contacts your whole team works with, like preferred lenders, title companies and inspectors. Each person chooses what to share, and shared contacts show up for everyone.',
  },
  {
    title: 'Invite teammates in a minute',
    body: 'Enter a teammate’s email and they join your team with full Team access right away. No separate payment on their side; it is covered by your subscription. Remove a seat any time.',
  },
  {
    title: 'Everything in Pro, for every seat',
    body: 'Each teammate gets AI contract intake, custom checklist templates, unlimited agent profiles, QuickBooks import and export, the client portal, and the rest of Relay Pro.',
  },
  {
    title: 'A status report for the owner',
    body: 'Download a spreadsheet of where every teammate’s open files stand: stage, checklist progress, closing date, next deadline and anything overdue. Status only, with no prices, client names, documents or messages.',
  },
  {
    title: 'Seats that grow with you',
    body: 'Three seats are included in $89 a month. Add a fourth seat and it is prorated at $30 a month. Remove someone and the seat count goes back down.',
  },
];

const WORKFLOW: { title: string; body: string }[] = [
  { title: 'Start Team', body: 'Pick the Team plan. Three seats are included, so you can bring in two teammates right away.' },
  { title: 'Invite your coordinators', body: 'Add their emails from Collaborate. They sign up or sign in and land on your team with full access.' },
  { title: 'Talk and share', body: 'Use the team board and direct messages to coordinate, and share the lenders, title companies and inspectors everyone uses.' },
  { title: 'Keep an eye on the whole pipeline', body: 'The owner downloads a status report to see every open file, checklist progress and overdue dates. Client details never leave each coordinator’s account.' },
];

const STAYS_PRIVATE = [
  'Each coordinator’s deals, listings, agents, contacts and documents stay private to their own login, including from the team owner',
  'Each coordinator invoices their own agents and gets paid directly. Relay never touches that money',
  'Messages between teammates are only visible to the people in them',
  'The owner’s status report shows stage and dates only: no prices, client names, documents, messages or contacts',
];

export default function ForTeamsPage() {
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
            <Link href="/for-agents" className="hover:text-slate-100 transition">For Agents</Link>
            <Link href="/for-teams" className="text-slate-100">For Teams</Link>
          </nav>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href="/auth" className="hidden sm:inline text-sm text-slate-300 hover:text-slate-100 transition whitespace-nowrap">Sign In</Link>
            <Link
              href="/auth?mode=signup&plan=team"
              className="px-3 sm:px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition whitespace-nowrap"
            >
              Start Team
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">For TC Teams</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Run a coordination team without sharing a login.
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
          Collaborate gives every coordinator on your team their own private workspace, plus one shared place to talk,
          share contacts and see where every file stands. $89 a month for three seats.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/auth?mode=signup&plan=team"
            className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10"
          >
            Start Team
          </Link>
          <Link
            href="#features"
            className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition"
          >
            See what teams get
          </Link>
        </div>
      </section>

      {/* Video */}
      {TEAMS_VIDEO_READY && (
        <section className="max-w-4xl mx-auto px-6 pb-20">
          <TeamsVideo src="/video/relay-tc-teams.mp4" poster="/video/relay-tc-teams-poster.jpg" length="Team workflow" />
          <p className="text-xs text-slate-500 mt-3 text-center">A walkthrough of the team workflow, from invite to status report.</p>
        </section>
      )}

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 pb-20 scroll-mt-20">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4 text-center">What Collaborate gives your team</h2>
        <p className="text-slate-400 mb-12 max-w-2xl mx-auto text-center">
          Everything a small team needs to stay in sync, without putting anyone’s clients in a shared pile.
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

      {/* Workflow */}
      <section className="max-w-5xl mx-auto px-6 pb-20 border-t border-slate-700 pt-16">
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-10 text-center">How a team works in Relay</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 text-center">
          {WORKFLOW.map((s, i) => (
            <div key={s.title}>
              <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/40 text-blue-300 font-semibold flex items-center justify-center mx-auto mb-4">
                {i + 1}
              </div>
              <h3 className="font-semibold text-slate-100 mb-2">{s.title}</h3>
              <p className="text-sm text-slate-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stays private */}
      <section className="max-w-4xl mx-auto px-6 pb-20 border-t border-slate-700 pt-16">
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-4 text-center">What stays private</h2>
        <p className="text-slate-400 max-w-2xl mx-auto text-center mb-8">
          A team is not a shared pipeline. Relay keeps each coordinator’s work and clients separate on purpose.
        </p>
        <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-4 text-sm text-slate-300 max-w-3xl mx-auto">
          {STAYS_PRIVATE.map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              {line}
            </li>
          ))}
        </ul>
      </section>

      {/* Pricing */}
      <section className="max-w-4xl mx-auto px-6 pb-24 border-t border-slate-700 pt-16 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">$89 a month for three seats</h2>
        <p className="text-slate-400 max-w-2xl mx-auto mb-3">
          Each extra seat is $30 a month. Agents never need a seat: the agent portal and client portal are free on every plan.
        </p>
        <p className="text-sm text-slate-500 mb-8">Working solo? <Link href="/pricing" className="text-blue-400 hover:text-blue-300">Pro is $39 a month</Link>.</p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link href="/auth?mode=signup&plan=team" className="px-8 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition">
            Start Team
          </Link>
          <Link href="/pricing" className="px-8 py-3 border border-slate-600 hover:border-slate-500 text-slate-200 font-semibold rounded-lg transition">
            Compare plans
          </Link>
          <DemoRequestButton className="px-6 py-3 text-slate-300 hover:text-slate-100 font-semibold transition" label="Request a demo" />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/relay-icon.png" alt="Relay TC" className="w-6 h-6 object-contain" />
            <span className="text-sm text-slate-400">Relay TC</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-500 flex-wrap justify-center">
            <Link href="/" className="hover:text-slate-200 transition">Home</Link>
            <Link href="/pricing" className="hover:text-slate-200 transition">Pricing</Link>
            <Link href="/faq" className="hover:text-slate-200 transition">FAQ</Link>
            <Link href="/for-agents" className="hover:text-slate-200 transition">For Agents</Link>
            <Link href="/auth" className="hover:text-slate-200 transition">Sign In</Link>
            <Link href="/terms" className="hover:text-slate-200 transition">Terms</Link>
            <Link href="/privacy" className="hover:text-slate-200 transition">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
