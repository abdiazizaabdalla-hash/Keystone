import Link from 'next/link';

export const metadata = {
  title: 'Status - Relay TC',
};

interface SystemRow {
  name: string;
  description: string;
}

const SYSTEMS: SystemRow[] = [
  { name: 'Application', description: 'The Relay TC web app, hosted on Vercel.' },
  { name: 'Database & file storage', description: 'Transaction data and uploaded documents, hosted on Supabase.' },
  { name: 'Email', description: 'Outbound email (invoices, signature requests, reminders, invites) and inbound per-transaction email, via Resend.' },
  { name: 'Payments', description: 'Subscription billing and agent payouts, via Stripe.' },
];

export default function StatusPage() {
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
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Status</p>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <h1 className="font-display text-4xl font-semibold text-slate-100">All systems operational</h1>
        </div>
        <p className="text-slate-500 text-sm mb-12">
          Relay TC is built on a small number of established providers, each responsible for one part of
          the stack. We don&apos;t currently publish automated uptime metrics or incident history for each
          one individually — if something is wrong, the fastest way to reach us is{' '}
          <a href="mailto:support@relaytc.com" className="text-blue-400 hover:text-blue-300">support@relaytc.com</a>.
        </p>

        <div className="space-y-4">
          {SYSTEMS.map((system) => (
            <div
              key={system.name}
              className="flex items-start justify-between gap-4 border border-slate-800 rounded-lg px-5 py-4"
            >
              <div>
                <h2 className="text-sm font-semibold text-slate-100 mb-1">{system.name}</h2>
                <p className="text-sm text-slate-500">{system.description}</p>
              </div>
              <span className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-emerald-400 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Operational
              </span>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-600 mt-10">
          Each of these providers also publishes its own public status page: Vercel, Supabase, Resend, and
          Stripe all have one, and are usually the fastest source of truth if you suspect an outage that
          isn&apos;t specific to Relay.
        </p>
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
            <Link href="/changelog" className="hover:text-slate-200 transition">Changelog</Link>
            <Link href="/terms" className="hover:text-slate-200 transition">Terms</Link>
            <Link href="/privacy" className="hover:text-slate-200 transition">Privacy</Link>
            <Link href="/auth" className="hover:text-slate-200 transition">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
