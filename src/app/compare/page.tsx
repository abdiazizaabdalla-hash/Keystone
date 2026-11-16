import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';

// Competitor facts come from the vendors' public pages and review sites, read in November 2026 (sources listed on the page).
// Keep every cell factual and neutral. "Not confirmed" means we could not verify it from those sources, not that it is absent.

const COLS = ['Relay', 'Dotloop', 'SkySlope', 'Paperless Pipeline', 'Open To Close', 'Brokermint'] as const;

const ROWS: { label: string; cells: string[] }[] = [
  {
    label: 'Built for',
    cells: ['Agents, coordinators, TC teams and brokerages on the same file', 'Agents, teams and brokerages', 'Brokerages that need compliance review', 'Brokerages, offices, admins and TCs', 'Transaction coordinators and their task lists', 'Brokerage back office'],
  },
  {
    label: 'Prices published',
    cells: ['Yes, every plan', 'Agent plan only; teams and brokerages by quote', 'By quote', 'Starting price published', 'Roughly $99 to $399 a month (third-party estimate)', 'By quote'],
  },
  {
    label: 'Starting price',
    cells: ['$19 a month; brokerages $99 a month with agents included', 'About $32 a month for an agent, with a free tier of 10 loops', 'Not published', 'From $69 a month, priced by transaction', 'Not confirmed', 'Estimated from $99 a month'],
  },
  {
    label: 'AI reads the contract',
    cells: ['Yes: builds the transaction or listing', 'Not confirmed', 'AI-driven brokerage insights', 'Not confirmed', 'Yes: turns a contract into a timeline', 'Not confirmed'],
  },
  {
    label: 'Brokerage compliance review',
    cells: ['Yes: required steps and document lists, file review and a review record', 'Compliance workflows on brokerage plans', 'Yes: its main strength', 'Yes: document compliance and audit-ready files', 'Not its focus', 'Yes: checklists and review'],
  },
  {
    label: 'Commissions',
    cells: ['Statements, approval and mark-paid, with payment through Stripe', 'Not confirmed', 'Commission statements and disbursement', 'Commission tracking', 'Not confirmed', 'Commission automation: its main strength'],
  },
  {
    label: 'E-signature',
    cells: ['Built in', 'Built in', 'Built in', 'Built in', 'Not confirmed', 'Not confirmed'],
  },
  {
    label: 'Integrations',
    cells: ['Google Calendar, QuickBooks, Stripe. No public API or Zapier yet', 'MLS and association feeds; API and SSO on top plans', 'Forms and accounting integrations', 'Over 3,000 through Zapier', 'Not confirmed', 'Works with kvCORE'],
  },
  {
    label: 'Accounting',
    cells: ['QuickBooks sync. No built-in ledger', 'No', 'SkySlope Books', 'Not accounting software', 'No', 'Yes, on its top plan'],
  },
];

const DIFFERENT: { title: string; body: string }[] = [
  { title: 'One file for every role', body: 'The agent, the coordinator, the team lead and the broker each see the same deal with the view they need. Most tools are built around one of those seats.' },
  { title: 'Prices you can read', body: 'Agents and coordinators pay $19 or $39 a month. A brokerage pays $99 or $199 a month with its agents included. No sales call to find out.' },
  { title: 'AI that starts the file', body: 'Upload the contract and Relay fills in the transaction or listing, the dates and the checklist. You check it and save.' },
  { title: 'Private by design for teams', body: 'On a TC team, each coordinator’s files stay theirs. The team lead sees status, never prices, documents or client details.' },
];

const AHEAD: { title: string; body: string }[] = [
  { title: 'Forms and MLS connections', body: 'Dotloop and others connect to MLS and association forms. Relay does not yet. You upload your own contracts and use Relay’s templates.' },
  { title: 'Open integrations', body: 'Paperless Pipeline lists thousands of Zapier connections. Relay connects to Google Calendar, QuickBooks and Stripe, with no public API yet.' },
  { title: 'Full back-office accounting', body: 'SkySlope Books and Brokermint include accounting for a brokerage. Relay hands your invoices and commissions to QuickBooks instead.' },
  { title: 'Track record', body: 'These tools have run thousands of brokerages for years. Relay is newer, which is why we offer a 14-day free trial and a 30-day brokerage pilot.' },
];

const SOURCES: { label: string; href: string }[] = [
  { label: 'Dotloop pricing summary, Software Advice', href: 'https://www.softwareadvice.com/project-management/dotloop-profile/' },
  { label: 'Dotloop plans, Toolradar', href: 'https://toolradar.com/tools/dotloop' },
  { label: 'SkySlope overview, Capterra', href: 'https://www.capterra.com/p/172896/SkySlope/' },
  { label: 'Paperless Pipeline vs Open To Close, Paperless Pipeline', href: 'https://www.paperlesspipeline.com/pipeline-vs-open-to-close' },
  { label: 'Best transaction management software 2026, Layer3 Labs', href: 'https://www.layer3labs.io/comparisons/best-real-estate-transaction-management-software' },
  { label: 'BoldTrail Back Office (Brokermint), Capterra', href: 'https://www.capterra.com/p/171321/Brokermint/' },
];

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader active="/compare" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-10 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">How Relay compares</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">Honest about where we fit.</h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto">
          Relay sits next to Dotloop, SkySlope, Paperless Pipeline, Open To Close and Brokermint. Here is what each is built for, what it costs, and where each one is ahead today.
        </p>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-12">
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm min-w-[56rem]">
            <thead>
              <tr className="bg-slate-800/80 border-b border-slate-700">
                <th className="text-left font-medium text-slate-400 px-4 py-4 w-40" />
                {COLS.map((c, i) => (
                  <th key={c} className={`text-left font-semibold px-4 py-4 ${i === 0 ? 'text-blue-300 bg-blue-500/10' : 'text-slate-200'}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, r) => (
                <tr key={row.label} className={r % 2 === 0 ? 'bg-slate-800/30' : ''}>
                  <th scope="row" className="text-left font-medium text-slate-300 px-4 py-3.5 border-t border-slate-700/60 align-top">{row.label}</th>
                  {row.cells.map((cell, i) => (
                    <td key={i} className={`px-4 py-3.5 border-t border-slate-700/60 align-top ${i === 0 ? 'text-slate-100 bg-blue-500/5' : 'text-slate-400'}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Reviewed November 2026 from each vendor’s public pages and review sites. “Not confirmed” means we could not verify it from those sources, not that the feature is missing. Plans change, so check each vendor before you decide.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-8">Where Relay is different</h2>
        <div className="grid sm:grid-cols-2 gap-5">
          {DIFFERENT.map((d) => (
            <div key={d.title} className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
              <h3 className="font-semibold text-slate-100 mb-2">{d.title}</h3>
              <p className="text-sm text-slate-400">{d.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Where others are ahead today</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">Better you hear it from us. If one of these decides it for you, one of them is probably the right tool.</p>
        <div className="grid sm:grid-cols-2 gap-5">
          {AHEAD.map((d) => (
            <div key={d.title} className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
              <h3 className="font-semibold text-slate-100 mb-2">{d.title}</h3>
              <p className="text-sm text-slate-400">{d.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">What about CRMs?</h2>
        <p className="text-slate-400 max-w-3xl">
          Tools like Follow Up Boss and kvCORE manage leads and marketing before a deal exists. Relay starts when there is a contract and runs the deal to closing. Most agents and brokerages use both.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-12 border-t border-slate-700">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Sources</h2>
        <ul className="space-y-1.5 text-sm">
          {SOURCES.map((s) => (
            <li key={s.href}><a href={s.href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">{s.label}</a></li>
          ))}
        </ul>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Try it on a real deal.</h2>
        <p className="text-slate-400 mb-6">Free for 14 days, no card needed. Brokerages get a 30-day pilot.</p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/get-started" className="px-7 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10">Get started</Link>
          <Link href="/pricing" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">See pricing</Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
