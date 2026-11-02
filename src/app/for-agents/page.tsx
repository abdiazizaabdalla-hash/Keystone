import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';

const WAYS: { title: string; body: string }[] = [
  {
    title: 'You handle your own deals',
    body: 'Keep every contract, deadline, document and client update in one place instead of in your inbox and a spreadsheet.',
  },
  {
    title: 'You want Relay to do the coordination work',
    body: 'Upload the executed contract. Relay builds the deal, the checklist and the deadlines, and reminds you before each one is due.',
  },
  {
    title: 'You work with a TC',
    body: 'Keep your own view of every deal. Coordinators who use Relay can add you to their deals, and you get a free login for those.',
  },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Upload the contract', body: 'Drop in the executed purchase agreement. Relay reads the address, price, parties and key dates.' },
  { title: 'Check what it found', body: 'You review the extracted details before anything is saved. Nothing important is changed without you.' },
  { title: 'Let the checklist run', body: 'A checklist is built for the deal, with due dates and a ready-to-send email on each step.' },
  { title: 'Keep everyone informed', body: 'Share a live progress page with your client. Dates, documents and messages stay in one place.' },
];

const FEATURES: { title: string; body: string }[] = [
  { title: 'AI contract intake', body: 'Address, price, parties and key dates pulled from the contract, then confirmed by you.' },
  { title: 'Deadlines you will not miss', body: 'Every key date on one calendar, with reminders before each is due and a link for Google, Outlook or Apple Calendar.' },
  { title: 'Checklists for every deal', body: 'A baseline checklist for each deal, or build your own templates. See what is done, overdue and next.' },
  { title: 'Documents and e-signature', body: 'File documents by category, request signatures right from the file, and get signed copies back by email.' },
  { title: 'A deal email address', body: 'Every deal gets its own address. CC it or forward to it and the conversation stays with the deal.' },
  { title: 'A page your client can follow', body: 'Buyers and sellers see progress, important dates and the documents you choose to share, with no login needed for basic updates.' },
  { title: 'Listings and offers', body: 'Take a listing from prep through offers and showings, then convert it to a deal in one click.' },
  { title: 'Contacts that remember', body: 'Lenders, title companies and inspectors saved once and reused, with notes and follow-ups.' },
];

export default function ForAgentsPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader active="/for-agents" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-14 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">For agents</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Run your own transactions. <span className="italic text-blue-400">Or work with your TC.</span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
          Upload a contract and Relay builds the deal, the checklist and the deadlines. You get one place for
          every transaction, whether you coordinate it yourself or share it with a coordinator.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/auth?mode=signup&as=agent&plan=starter"
            className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10"
          >
            Get started as an agent
          </Link>
          <Link href="#how" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">
            See how it works
          </Link>
        </div>
        <p className="text-xs text-slate-500 mt-5">Free for 30 days. No credit card required.</p>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-16">
        <div className="grid md:grid-cols-3 gap-5">
          {WAYS.map((w) => (
            <div key={w.title} className="bg-slate-800/60 border border-slate-700 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-slate-100 mb-2">{w.title}</h2>
              <p className="text-sm text-slate-400">{w.body}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-slate-500 mt-4 text-center">You choose when you sign up. It only sets up your first screens, and you can use all of Relay either way.</p>
      </section>

      <section id="how" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Upload once. Relay does the setup.</h2>
        <p className="text-slate-400 mb-10 max-w-2xl">You should be able to get value from your first contract in minutes, not after a long setup.</p>
        <ol className="grid md:grid-cols-4 gap-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="bg-slate-800/60 border border-slate-700 rounded-xl p-6">
              <span className="w-8 h-8 rounded-full bg-blue-500 text-white text-sm font-semibold flex items-center justify-center mb-4">{i + 1}</span>
              <h3 className="font-semibold text-slate-100 mb-2">{s.title}</h3>
              <p className="text-sm text-slate-400">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-10">The whole platform, not a stripped-down version</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
              <h3 className="font-semibold text-slate-100 mb-2">{f.title}</h3>
              <p className="text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="with-tc" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-8 sm:p-10 grid md:grid-cols-[3fr_2fr] gap-8 items-center">
          <div>
            <h2 className="font-display text-2xl font-semibold text-slate-100 mb-3">Already work with a coordinator who uses Relay?</h2>
            <p className="text-slate-400">
              When your TC adds you to a deal you get a free agent login: the checklist, the documents, a direct
              line to your TC and a live page for your clients. No subscription, nothing to set up.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link href="/agent/login" className="px-5 py-3 bg-blue-500 hover:bg-blue-400 text-white text-center font-semibold rounded-lg transition">Log in as an agent</Link>
            <Link href="/for-agents/portal" className="px-5 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 text-center font-semibold rounded-lg transition">What the free portal includes</Link>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">On the roadmap</p>
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-3">More of the coordination, handled for you.</h2>
        <p className="text-slate-400 max-w-3xl">
          We are working on understanding the emails and amendments on a deal, drafting follow-ups for missing
          documents, and flagging what needs your attention. Each of these will propose a change and ask before
          anything is sent or updated, and you will be able to pause or turn it off. They are not available yet.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-slate-100 mb-1">Simple pricing</h2>
            <p className="text-slate-400">Free for 30 days, then Starter is $19 a month with unlimited transactions. Pro is $39.</p>
          </div>
          <Link href="/pricing" className="text-blue-400 hover:text-blue-300 font-medium text-sm">Compare plans →</Link>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-6">Upload your first contract today.</h2>
        <Link
          href="/auth?mode=signup&as=agent&plan=starter"
          className="inline-block px-7 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10"
        >
          Get started as an agent
        </Link>
      </section>

      <PublicFooter />
    </div>
  );
}
