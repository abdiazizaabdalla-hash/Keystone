import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import AgentPlanCards from '@/components/marketing/AgentPlanCards';
import { AgentPathsIllustration } from '@/components/marketing/Illustrations';

const WORKFLOW: { title: string; body: string }[] = [
  { title: 'Upload the contract', body: 'AI reads it and fills out and creates the transaction or listing for you, with the address, price, parties and key dates. You check and save.' },
  { title: 'Follow every step', body: 'A checklist with due dates and a ready-to-send template on each step. Switch on automations and Relay sends the reminders and follow-ups for you.' },
  { title: 'Keep clients informed', body: 'Share a live progress page with your buyer or seller, with only the documents and steps you choose.' },
  { title: 'Listings, separate from transactions', body: 'Listings have their own page for offers and showings, with their own templates and automations. Convert one to a transaction in one click.' },
  { title: 'Close and invoice', body: 'See your invoices alongside the deal.' },
];


export default function ForAgentsPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader active="/for-agents" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-12 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">For agents</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Your deals and listings, <span className="text-blue-400">in one workspace.</span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
          Run your own transactions and listings in one workspace. Start on Starter, or move up to Pro for automations and more. If your coordinator has a Relay account, you can collaborate with them directly.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/get-started" className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10">Start a free 14-day trial</Link>
          <Link href="/for-brokerages" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">Ask your brokerage</Link>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-16"><AgentPathsIllustration /></section>

      <section className="max-w-7xl mx-auto px-6 pb-16">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Templates and automations</h2>
        <p className="text-slate-400 max-w-3xl mb-8">Use your brokerage’s shared templates and Relay’s standard forms on both plans. Pro adds custom checklist templates and automations that send reminders and follow-ups for you.</p>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Two plans for agents</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">Both start free for 14 days, no card needed. Pro adds automations, custom checklist templates and more.</p>
        <AgentPlanCards />
        <p className="text-xs text-slate-500 mt-5">Brokerages can also invite their agents. <Link href="/for-brokerages" className="text-blue-400 hover:text-blue-300">See brokerage plans</Link> for the 10 and 25 agent options.</p>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-10">How a deal runs in your workspace</h2>
        <ol className="grid md:grid-cols-4 gap-5">
          {WORKFLOW.map((s, i) => (
            <li key={s.title} className="bg-slate-800/60 border border-slate-700 rounded-xl p-6">
              <span className="w-8 h-8 rounded-full bg-blue-500 text-white text-sm font-semibold flex items-center justify-center mb-4">{i + 1}</span>
              <h3 className="font-semibold text-slate-100 mb-2">{s.title}</h3>
              <p className="text-sm text-slate-400">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Not sure which one you are?</h2>
        <p className="text-slate-400 mb-6">If your broker has told you they use Relay, ask them to invite you. Otherwise start with Starter or Pro.</p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/get-started" className="px-7 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10">Start a free 14-day trial</Link>
          <Link href="/pricing#agents" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">See agent pricing</Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
