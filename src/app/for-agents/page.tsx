import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';

const WAYS: { title: string; body: string }[] = [
  {
    title: 'Your TC adds you to a deal',
    body: 'Coordinators who use Relay add you to a transaction. You get a free agent login, with nothing to buy or set up.',
  },
  {
    title: 'You see the same deal they do',
    body: 'The checklist, the documents and the dates are all in front of you. Upload a file, send a message or check something off.',
  },
  {
    title: 'Your clients stay in the loop',
    body: 'Generate a live progress page for your buyer or seller and invite them, so they are not left wondering where things stand.',
  },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Your TC invites you', body: 'When a coordinator adds you to a deal, Relay sends you a login for that deal.' },
  { title: 'Open the deal', body: 'See the checklist, deadlines and documents without chasing anyone for an update.' },
  { title: 'Message your TC', body: 'Questions and updates live on the deal, not in a long email thread.' },
  { title: 'Share with your client', body: 'Create a live progress page and invite your buyer or seller to follow along.' },
];

const FEATURES: { title: string; body: string }[] = [
  { title: 'The deal checklist', body: 'See what is done, what is overdue and what is next on every transaction.' },
  { title: 'Deadlines in one place', body: 'Every key date on one calendar, with a link for Google, Outlook or Apple Calendar.' },
  { title: 'Documents', body: 'View what is on file and add your own documents to the deal.' },
  { title: 'A direct line to your TC', body: 'Message your coordinator on the deal itself.' },
  { title: 'Client progress page', body: 'Buyers and sellers see progress, important dates and the documents you choose to share.' },
  { title: 'Free, always', body: 'The agent portal never needs a paid Relay subscription.' },
];

export default function ForAgentsPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader active="/for-agents" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-14 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">For agents</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Stay in the loop on every deal. <span className="italic text-blue-400">Free.</span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
          When your transaction coordinator uses Relay, you get a free agent login for the deals they add you to:
          the checklist, the documents, a direct line to your TC, and a live page for your clients.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/agent/login"
            className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10"
          >
            Log in as an agent
          </Link>
          <Link href="#how" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">
            See how it works
          </Link>
        </div>
        <p className="text-xs text-slate-500 mt-5">No subscription and nothing to set up. Your TC invites you.</p>
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
      </section>

      <section id="how" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Know where every deal stands.</h2>
        <p className="text-slate-400 mb-10 max-w-2xl">No more chasing your coordinator for an update, and no more clients asking you what is happening.</p>
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
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-10">What the free portal includes</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
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

      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Is your coordinator not on Relay yet?</h2>
        <p className="text-slate-400 mb-6">Send them this page. Coordinators can try Relay free for 30 days.</p>
        <Link
          href="/for-tcs"
          className="inline-block px-7 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10"
        >
          See Relay for coordinators
        </Link>
      </section>

      <PublicFooter />
    </div>
  );
}
