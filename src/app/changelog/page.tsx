import Link from 'next/link';

export const metadata = {
  title: 'Changelog & Roadmap - Relay TC',
};

interface Entry {
  date?: string;
  title: string;
  body: string;
}

const SHIPPED: Entry[] = [
  {
    date: 'October 2026',
    title: 'Brokerage pricing tier',
    body: 'A seat-based plan sized for a broker buying access across a whole team — 10-seat minimum at $15/seat/month, on the same shared-roster billing as the Team plan.',
  },
  {
    date: 'October 2026',
    title: 'Scoped external access links',
    body: 'Share a single document, or a read-only view of a transaction, with someone outside Relay — a lender, an attorney, a client — through a link you control and can revoke at any time, without creating them an account.',
  },
  {
    date: 'October 2026',
    title: 'Compliance & audit export',
    body: 'Export a complete, dated record of a transaction — its checklist history, documents, and communications — as a single PDF, for a broker file review or an audit request.',
  },
  {
    date: 'October 2026',
    title: 'Full-text search',
    body: 'Search across every transaction, message, document, and task you have access to from one search bar, instead of hunting through individual deals.',
  },
  {
    date: 'September 2026',
    title: 'AI contract intake',
    body: 'Upload a signed contract to a new transaction and Relay reads it for you — property address, parties, key dates — instead of you re-typing it in by hand.',
  },
  {
    date: 'September 2026',
    title: 'Per-transaction email ingestion',
    body: 'Every transaction gets its own email address. Forward or CC it and the message — and any attachments — land directly in that deal’s communication log.',
  },
  {
    date: 'September 2026',
    title: '"Needs Attention Today" dashboard',
    body: 'Your dashboard leads with what actually needs you today — overdue items and anything due soon — instead of a flat list of every open transaction.',
  },
  {
    date: 'September 2026',
    title: 'Deadline reminders',
    body: 'Checklist tasks with a due date now send an advance-notice reminder before they’re late, not just after.',
  },
  {
    date: 'September 2026',
    title: '"Waiting On" field on checklist tasks',
    body: 'Mark exactly who a checklist task is waiting on — lender, title, the buyer’s agent — so it’s clear at a glance where a stalled item is actually stuck.',
  },
];

const UP_NEXT: Entry[] = [
  {
    title: 'Migration concierge',
    body: 'White-glove onboarding for switching to Relay: send us your current spreadsheet or Dropbox and we’ll set up your first few transactions for you.',
  },
  {
    title: 'Named customer case studies',
    body: 'Real stories from real Relay customers, once we have some who are happy to be named.',
  },
];

function EntryCard({ entry }: { entry: Entry }) {
  return (
    <div className="border-b border-slate-800 pb-6 last:border-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-4 mb-1.5">
        <h3 className="text-base font-semibold text-slate-100">{entry.title}</h3>
        {entry.date && <span className="text-xs text-slate-500 whitespace-nowrap">{entry.date}</span>}
      </div>
      <p className="text-sm text-slate-400 leading-relaxed">{entry.body}</p>
    </div>
  );
}

export default function ChangelogPage() {
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
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/auth" className="text-sm text-slate-300 hover:text-slate-100 transition">Sign In</Link>
          </div>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-6 pt-16 pb-24">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Product</p>
        <h1 className="font-display text-4xl font-semibold text-slate-100 mb-3">Changelog &amp; roadmap</h1>
        <p className="text-slate-500 text-sm mb-12">
          What we’ve shipped recently, and what we’re building next. Relay is actively developed —
          this page is kept current rather than being a one-time launch announcement.
        </p>

        <div className="mb-16">
          <h2 className="text-xs font-semibold tracking-wider text-slate-400 uppercase mb-6">Shipped</h2>
          <div className="space-y-6">
            {SHIPPED.map((entry) => (
              <EntryCard key={entry.title} entry={entry} />
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-xs font-semibold tracking-wider text-slate-400 uppercase mb-6">Up next</h2>
          <div className="space-y-6">
            {UP_NEXT.map((entry) => (
              <EntryCard key={entry.title} entry={entry} />
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-8">
            Have a feature you need? Email{' '}
            <a href="mailto:support@relaytc.com" className="text-blue-400 hover:text-blue-300">support@relaytc.com</a>{' '}
            and tell us about it.
          </p>
        </div>
      </section>

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
            <Link href="/security" className="hover:text-slate-200 transition">Security</Link>
            <Link href="/status" className="hover:text-slate-200 transition">Status</Link>
            <Link href="/terms" className="hover:text-slate-200 transition">Terms</Link>
            <Link href="/privacy" className="hover:text-slate-200 transition">Privacy</Link>
            <Link href="/auth" className="hover:text-slate-200 transition">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
