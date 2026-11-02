import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import DemoRequestButton from '@/components/DemoRequestButton';

const FEATURES: { title: string; body: string }[] = [
  { title: 'Start with the contract', body: 'Upload the purchase agreement and Relay fills in the deal: address, price, parties and key dates. You review, then save.' },
  { title: 'Checklists with due dates', body: 'A checklist for every deal, custom templates on Pro, due dates set by rule, and a ready-to-send email on each step.' },
  { title: 'Every deadline tracked', body: 'Critical dates on one calendar, reminders before each is due, and what needs you today at the top of your dashboard.' },
  { title: 'Agents on the deal', body: 'Add an agent and they get a free portal login: the checklist, documents, messages and a live progress page for their clients.' },
  { title: 'Listings to closing', body: 'Listing intake, offers and showings, then convert to a transaction in one click.' },
  { title: 'Invoicing with the deal', body: 'Invoice the agent when you close. Stripe payments, manual and Zelle recording, and QuickBooks import and export.' },
  { title: 'A page for every deal', body: 'Documents by category, e-signature, a deal email address, and a message board for the agent and client.' },
  { title: 'Teams that stay private', body: 'Add coordinators on a Team plan. They share a message board and contacts, and each keeps their own deals private.' },
];

export default function ForTcsPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader active="/for-tcs" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-14 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">For transaction coordinators</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Listing to closing, <span className="italic text-blue-400">all in one workspace.</span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
          Relay helps coordinators keep listings, offers, checklists, documents, deadlines, agent communication and
          invoicing together on every deal, so you can take on more files without more chaos.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/auth?mode=signup&plan=starter" className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10">
            Start free
          </Link>
          <Link href="/#demo" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">
            Watch the video
          </Link>
        </div>
        <p className="text-xs text-slate-500 mt-5">Free for 30 days. No credit card required.</p>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
              <h2 className="font-semibold text-slate-100 mb-2">{f.title}</h2>
              <p className="text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-8 sm:p-10">
          <h2 className="font-display text-2xl font-semibold text-slate-100 mb-3">Your agents stay in the loop</h2>
          <p className="text-slate-400 max-w-3xl mb-6">
            Add an agent to a deal and they get a free portal login. You and the agent see the same deal, and your private notes stay private.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-6">Run your next closing in Relay.</h2>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/auth?mode=signup&plan=starter" className="px-7 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10">Start free</Link>
          <Link href="/pricing" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">Compare plans</Link>
          <DemoRequestButton className="px-6 py-3 text-slate-300 hover:text-slate-100 font-semibold transition" label="Request a demo" />
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
