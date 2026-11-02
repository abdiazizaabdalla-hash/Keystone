import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import DemoRequestButton from '@/components/DemoRequestButton';

const PLANNED: { title: string; body: string }[] = [
  { title: 'Every transaction, one view', body: 'Active deals, upcoming closings, overdue tasks and what needs attention across agents and offices.' },
  { title: 'Assign coordinators', body: 'Put the right TC on each deal and move a deal to another coordinator without starting over.' },
  { title: 'Standard checklists', body: 'Brokerage-wide checklists and required documents, so every agent works from the same playbook.' },
  { title: 'Roles and permissions', body: 'Admins, brokers, agents and coordinators each see only what they should. Being in the brokerage never means seeing everything.' },
  { title: 'Reviewable compliance', body: 'Document checks that your authorized staff review and decide. Relay does not decide compliance for you.' },
  { title: 'Reporting', body: 'Closing volume, activity and exceptions, without asking every agent for an update.' },
];

export default function ForBrokeragesPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader active="/for-brokerages" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-14 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">For brokerages</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          See every transaction. <span className="italic text-blue-400">Without chasing updates.</span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
          Relay is the transaction workspace your agents and coordinators already use, extended with brokerage-level
          oversight. We are building it with the first brokerages now.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <DemoRequestButton className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10" label="Talk to us" />
          <Link href="/for-teams" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">
            Start with a team workspace
          </Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-display text-3xl font-semibold text-slate-100">What we are building</h2>
          <span className="text-[11px] font-bold tracking-wider uppercase bg-slate-700 text-slate-200 rounded-full px-3 py-1">In development</span>
        </div>
        <p className="text-slate-400 mb-10 max-w-2xl">
          Early access is by conversation. Tell us how your brokerage runs transactions and we will tell you
          honestly what fits today.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {PLANNED.map((f) => (
            <div key={f.title} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
              <h3 className="font-semibold text-slate-100 mb-2">{f.title}</h3>
              <p className="text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-3">Available today</h2>
        <p className="text-slate-400 max-w-3xl mb-6">
          A team workspace for coordinators (a shared board, shared contacts and an owner status report that shows
          where every file stands without client details), and individual accounts for every agent on their own
          transactions.
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/for-teams" className="text-blue-400 hover:text-blue-300 font-medium">Team workspaces →</Link>
          <Link href="/for-agents" className="text-blue-400 hover:text-blue-300 font-medium">Relay for agents →</Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
