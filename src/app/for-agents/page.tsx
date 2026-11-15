import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import DemoRequestButton from '@/components/DemoRequestButton';
import { AGENT_PRO } from '@/lib/marketingPricing';
import { AgentPathsIllustration } from '@/components/marketing/Illustrations';

const WORKFLOW: { title: string; body: string }[] = [
  { title: 'Upload the contract', body: 'Relay reads it and fills in the address, price, parties and key dates. You check and save.' },
  { title: 'Follow every step', body: 'A checklist with due dates and a ready-to-send email on each step, so nothing waits on memory.' },
  { title: 'Keep clients informed', body: 'Share a live progress page with your buyer or seller, with only the documents and steps you choose.' },
  { title: 'Close and invoice', body: 'Track your listings, offers and showings, then see your invoices alongside the deal.' },
];

const check = <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>;

export default function ForAgentsPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader active="/for-agents" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-12 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">For agents</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Your deals and listings, <span className="italic text-blue-400">in one workspace.</span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
          Run your own transactions without the spreadsheet and the email chase. Your brokerage can provide Relay for you, or you can start with Agent Pro on your own.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <DemoRequestButton className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10" label="Join the Agent Pro pilot" />
          <Link href="/for-brokerages" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">Ask your brokerage</Link>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-16"><AgentPathsIllustration /></section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Two ways to get Relay</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">You have one or the other, never both bills. If your brokerage provides it, it costs you nothing. If not, Agent Pro is {AGENT_PRO.price} a month.</p>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-7">
            <span className="inline-block text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-400/40 rounded-full px-2.5 py-0.5 mb-3">No cost to you</span>
            <h3 className="font-display text-xl font-semibold text-slate-100 mb-1">Provided by your brokerage</h3>
            <p className="text-sm text-slate-400 mb-5">Your brokerage invites you and covers it. Your broker can see your deals, so there is no separate reporting.</p>
            <ul className="space-y-2.5 text-sm text-slate-300">{AGENT_PRO.includedByBrokerage.map((l) => <li key={l} className="flex items-start gap-2.5">{check}{l}</li>)}</ul>
          </div>
          <div className="bg-slate-800/60 border border-blue-500/40 ring-2 ring-blue-500/10 rounded-2xl p-7">
            <span className="inline-block text-xs font-semibold text-blue-200 bg-blue-500/15 border border-blue-400/40 rounded-full px-2.5 py-0.5 mb-3">{AGENT_PRO.price}{AGENT_PRO.period}</span>
            <h3 className="font-display text-xl font-semibold text-slate-100 mb-1">Agent Pro</h3>
            <p className="text-sm text-slate-400 mb-5">Everything above, on your own subscription, plus the tools that save you the most time.</p>
            <ul className="space-y-2.5 text-sm text-slate-300">
              <li className="flex items-start gap-2.5">{check}Everything in the brokerage-provided workspace</li>
              {AGENT_PRO.proAdds.map((l) => <li key={l} className="flex items-start gap-2.5">{check}{l}</li>)}
            </ul>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-5">Agent Pro opens through a pilot first. Tell us you want in and we will set you up.</p>
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
        <p className="text-slate-400 mb-6">If your broker has told you they use Relay, ask them to invite you. Otherwise start with Agent Pro.</p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <DemoRequestButton className="px-7 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10" label="Join the Agent Pro pilot" />
          <Link href="/pricing#agents" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">See agent pricing</Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
