import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import DemoRequestButton from '@/components/DemoRequestButton';
import { BROKERAGE_TIERS, PILOT } from '@/lib/marketingPricing';
import { BrokerageDashboardIllustration, FileReviewIllustration, BrokerageHubIllustration } from '@/components/marketing/Illustrations';

const BEFORE = [
  'Asking agents for a status by text and email, deal by deal',
  'Finding the missing disclosure or receipt after the file has closed',
  'Commission splits tracked in a spreadsheet and by memory',
  'Every agent keeping their own checklist, or none at all',
  'Announcements and forms lost in a group chat',
];
const AFTER = [
  'One dashboard: open deals, late items and closings this week for every agent',
  'Required documents checked on every file, with missing ones flagged',
  'Commission statements agreed by both sides, with a ledger and an export',
  'Every agent working from a checklist with due dates, on their own deals',
  'A team board, private messages and your forms pinned for everyone',
];

const AGENT_GETS: { title: string; body: string }[] = [
  { title: 'Contract in, deal out', body: 'Upload the contract and Relay fills in the address, price, parties and key dates.' },
  { title: 'A checklist with due dates', body: 'Every step dated from the contract, with a ready-to-send email on each one.' },
  { title: 'Listings, offers, showings', body: 'Track a listing and convert it to a deal in one click.' },
  { title: 'A page for the client', body: 'A live progress page for the buyer or seller, with only what the agent chooses to share.' },
  { title: 'Your brokerage’s templates', body: 'The forms you share show up pinned in their template list and in every deal.' },
  { title: 'Contacts and follow-ups', body: 'Each agent keeps their own contacts and follow-ups, kept apart from everyone else’s.' },
  { title: 'Invoices', body: 'Invoices sit alongside the deal, with the commission terms you set.' },
  { title: 'No cost to them', body: 'Your plan covers the agents you include. They never see a bill.' },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Start the pilot', body: 'Tell us about your brokerage. We turn on 30 days of Brokerage Pro, with no card needed.' },
  { title: 'Invite your agents', body: 'Add their emails. Each gets a workspace at no cost to them and counts against the agents you include.' },
  { title: 'Choose your documents', body: 'Pick the documents every file must contain, and share your IABS and forms with the whole roster.' },
  { title: 'Decide at day 30', body: 'Stay on Pro, drop to Basic, or stop. Nothing renews by itself, and nothing is deleted.' },
];

const FAQ: { q: string; a: string }[] = [
  { q: 'Can I see my agents’ private notes?', a: 'You get a read-only view of deals, deadlines, listings and production, so you can see where things stand without changing anything. Private messages between you and an agent can be read only by the two of you.' },
  { q: 'Does Relay decide what is compliant?', a: 'No. Relay shows you what is on each file and what is missing against the list you set. Your authorized staff review it and decide, and your review is your own record. It never changes the agent’s deal.' },
  { q: 'What if an agent already uses Relay with a coordinator?', a: 'An agent can belong to one brokerage at a time, and keeps working with their coordinator as they do today.' },
  { q: 'What happens if we stop?', a: 'Nothing is deleted. Your account becomes read-only: you and your agents can still see and export everything, but you cannot invite more agents.' },
];

const check = <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>;
const cross = <svg className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>;
const soon = <span className="w-1.5 h-1.5 rounded-full bg-slate-500 mt-2 flex-shrink-0" />;
const eyebrow = 'text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3';
const h2 = 'font-display text-3xl font-semibold text-slate-100 mb-3';

export default function ForBrokeragesPage() {
  const { basic, pro, extraAgent } = BROKERAGE_TIERS;
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader active="/for-brokerages" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-12 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">For brokerages</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Stop chasing agents for a status. <span className="italic text-blue-400">See every file.</span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
          Relay gives each agent a workspace for their deals and gives you one view of the whole brokerage: where every file stands, what is missing, who is late and what is owed.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <DemoRequestButton className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10" label="Start a free 30-day pilot" />
          <Link href="#plans" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">See plans</Link>
        </div>
        <p className="text-xs text-slate-500 mt-5">{PILOT}</p>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-16">
        <div className="grid md:grid-cols-2 gap-5">
          <div className="bg-slate-800/40 border border-slate-700 rounded-2xl p-7">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-4">How it usually goes</p>
            <ul className="space-y-3 text-sm text-slate-400">{BEFORE.map((l) => <li key={l} className="flex items-start gap-2.5">{cross}{l}</li>)}</ul>
          </div>
          <div className="bg-slate-800/60 border border-blue-500/40 ring-2 ring-blue-500/10 rounded-2xl p-7">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-300 mb-4">With Relay</p>
            <ul className="space-y-3 text-sm text-slate-200">{AFTER.map((l) => <li key={l} className="flex items-start gap-2.5">{check}{l}</li>)}</ul>
          </div>
        </div>
      </section>

      <section id="oversight" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <p className={eyebrow}>Oversight</p>
        <h2 className={h2}>Know where every file stands, without asking.</h2>
        <p className="text-slate-400 max-w-3xl mb-8">Your dashboard opens on what you check first thing in the morning. Click an agent to see their deals and listings.</p>
        <BrokerageDashboardIllustration />
        <p className="text-xs text-slate-500 mt-3 mb-6 text-center">Illustration of the dashboard. Names and numbers are made up.</p>
        <ul className="grid md:grid-cols-2 gap-x-8 gap-y-3 text-sm text-slate-300">
          {[
            'Open deals, late items, closings this week and last activity, one row per agent',
            'A read-only look at every agent’s deals, key dates and listings',
            'Production by agent and month, exported when you need it',
            'What is late and what closes this week, up front, so the morning check takes minutes',
          ].map((l) => <li key={l} className="flex items-start gap-2.5">{check}{l}</li>)}
        </ul>
      </section>

      <section id="compliance" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <p className={eyebrow}>Compliance</p>
        <h2 className={h2}>Catch the missing document before the audit does.</h2>
        <p className="text-slate-400 max-w-3xl mb-8">You choose the documents every file must contain. Relay checks closed files, and files about to close, against that list and shows exactly what is missing.</p>
        <FileReviewIllustration />
        <ul className="grid md:grid-cols-2 gap-x-8 gap-y-3 text-sm text-slate-300 mt-8">
          {[
            'Set the required-document list once for the brokerage',
            'Missing documents flagged on each file, not buried in a report',
            'Mark each file reviewed, or flag it back to the agent',
            'Your review is your own record: it never changes the agent’s deal',
          ].map((l) => <li key={l} className="flex items-start gap-2.5">{check}{l}</li>)}
        </ul>
        <p className="text-sm text-slate-500 mt-6 max-w-3xl">Relay does not decide what is compliant. It gives your authorized staff the facts and a place to record their decision.</p>
      </section>

      <section id="team" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <p className={eyebrow}>Your team</p>
        <h2 className={h2}>Run the whole brokerage from one place.</h2>
        <p className="text-slate-400 max-w-3xl mb-8">Invite agents, talk to them, share your forms and keep the money straight, all next to the deals themselves.</p>
        <BrokerageHubIllustration />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-8">
          {[
            { t: 'Roster and invitations', b: 'Invite agents by email, see who has accepted, and cancel or resend from the same list.' },
            { t: 'Team board and private messages', b: 'Post to everyone, or message one agent privately. Only the two of you can read a private thread.' },
            { t: 'Your forms, pinned', b: 'Share your IABS, welcome letter or any template. It appears pinned in every agent’s templates and on their deals.' },
            { t: 'Commissions and invoices', b: 'Statements the agent and broker both agree to, then marked paid. A ledger by deal and a CSV export.' },
          ].map((f) => (
            <div key={f.t} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
              <h3 className="font-semibold text-slate-100 mb-2">{f.t}</h3>
              <p className="text-sm text-slate-400">{f.b}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="agents" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <p className={eyebrow}>What your agents get</p>
        <h2 className={h2}>A tool they will actually use.</h2>
        <p className="text-slate-400 max-w-3xl mb-8">Oversight only works if agents keep their files current. Relay does the typing for them, so they do.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {AGENT_GETS.map((f) => (
            <div key={f.title} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
              <h3 className="font-semibold text-slate-100 mb-2">{f.title}</h3>
              <p className="text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <p className={eyebrow}>Getting started</p>
        <h2 className={h2}>Switch in an afternoon, judge it on real files.</h2>
        <ol className="grid md:grid-cols-4 gap-5 mt-8">
          {STEPS.map((s, i) => (
            <li key={s.title} className="bg-slate-800/60 border border-slate-700 rounded-xl p-6">
              <span className="w-8 h-8 rounded-full bg-blue-500 text-white text-sm font-semibold flex items-center justify-center mb-4">{i + 1}</span>
              <h3 className="font-semibold text-slate-100 mb-2">{s.title}</h3>
              <p className="text-sm text-slate-400">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="plans" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <h2 className={h2}>Plans for brokerages</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">One price covers the brokerage and the agents you include. Your agents pay nothing. Need more agents? {extraAgent} a month each, on either plan.</p>
        <div className="grid md:grid-cols-2 gap-6">
          {[basic, pro].map((t, i) => (
            <div key={t.name} className={`rounded-2xl border p-7 flex flex-col ${i === 1 ? 'border-blue-500 bg-slate-700 ring-2 ring-blue-500/20' : 'border-slate-700 bg-slate-800/60'}`}>
              <h3 className="font-display text-2xl font-semibold text-slate-100 mb-1">{t.name}</h3>
              <p className="text-sm text-slate-400 mb-4">{t.blurb}</p>
              <p className="mb-1"><span className="text-4xl font-display font-semibold text-slate-100">{t.price}</span><span className="text-slate-400 ml-1">{t.period}</span></p>
              <p className="text-sm text-slate-300 mb-6">Includes {t.agents} agents</p>
              <ul className="space-y-2.5 text-sm text-slate-300">{t.built.map((l) => <li key={l} className="flex items-start gap-2.5">{check}{l}</li>)}</ul>
              {'rollingOut' in t && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-6 mb-2">Rolling out during the pilot</p>
                  <ul className="space-y-2.5 text-sm text-slate-400">{t.rollingOut.map((l) => <li key={l} className="flex items-start gap-2.5">{soon}{l}</li>)}</ul>
                </>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-5">Plans start after the pilot. Until then, nothing is billed.</p>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-6">Questions brokers ask</h2>
        <div className="space-y-5">
          {FAQ.map((f) => (
            <div key={f.q} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
              <h3 className="font-semibold text-slate-100 mb-1.5">{f.q}</h3>
              <p className="text-sm text-slate-400">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">See it with your own roster.</h2>
        <p className="text-slate-400 mb-6">Start the pilot, invite a few agents, and judge it on real files. No card, and nothing renews.</p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <DemoRequestButton className="px-7 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10" label="Start a free 30-day pilot" />
          <Link href="/pricing#brokerages" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">See all pricing</Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
