import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import { AGENT_PRO } from '@/lib/marketingPricing';
import { AgentPathsIllustration, TemplateSharingIllustration, AutomationAudiencesIllustration } from '@/components/marketing/Illustrations';

const WORKFLOW: { title: string; body: string }[] = [
  { title: 'Upload the contract', body: 'AI reads it and fills out and creates the transaction or listing for you, with the address, price, parties and key dates. You check and save.' },
  { title: 'Follow every step', body: 'A checklist with due dates and a ready-to-send template on each step. Switch on automations and Relay sends the reminders and follow-ups for you.' },
  { title: 'Keep clients informed', body: 'Share a live progress page with your buyer or seller, with only the documents and steps you choose.' },
  { title: 'Listings, separate from transactions', body: 'Listings have their own page for offers and showings, with their own templates and automations. Convert one to a transaction in one click.' },
  { title: 'Close and invoice', body: 'See your invoices alongside the deal.' },
];

const check = <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>;

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
          Run your own transactions and listings in one workspace. Your brokerage can provide Relay for you, or you can start with Agent Pro on your own.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/get-started" className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10">Start a free 14-day trial</Link>
          <Link href="/for-brokerages" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">Ask your brokerage</Link>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-16"><AgentPathsIllustration /></section>

      <section className="max-w-7xl mx-auto px-6 pb-16">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Templates and automations</h2>
        <p className="text-slate-400 max-w-3xl mb-8">Use your brokerage’s shared templates and Relay’s standard forms on any plan. Agent Pro adds your own templates and automations that send reminders and follow-ups for you.</p>
        <div className="space-y-6">
          <TemplateSharingIllustration />
          <AutomationAudiencesIllustration />
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Two plans for agents</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">The regular workspace is $0 to you when your brokerage provides Relay. Agent Pro is {AGENT_PRO.price} a month on your own. You are never billed for both.</p>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-7">
            
            <p className="text-3xl font-display font-semibold text-slate-100 mb-1">$0 <span className="text-base font-sans font-normal text-slate-400">to you</span></p>
            <p className="text-sm text-slate-400 mb-5">When your brokerage provides Relay. They invite you and cover it. </p>
            <ul className="space-y-2.5 text-sm text-slate-300">{AGENT_PRO.includedByBrokerage.map((l) => <li key={l} className="flex items-start gap-2.5">{check}{l}</li>)}</ul>
          </div>
          <div className="bg-slate-800/60 border border-blue-500/40 ring-2 ring-blue-500/10 rounded-2xl p-7">
            <p className="text-3xl font-display font-semibold text-slate-100 mb-1">{AGENT_PRO.price} <span className="text-base font-sans font-normal text-slate-400">{AGENT_PRO.period}</span></p>
            <h3 className="font-display text-xl font-semibold text-slate-100 mb-1">Agent Pro</h3>
            <p className="text-sm text-slate-400 mb-5">Everything in the regular workspace, on your own subscription, plus the tools that save you the most time.</p>
            <ul className="space-y-2.5 text-sm text-slate-300">
              <li className="flex items-start gap-2.5">{check}Everything in the brokerage-provided workspace</li>
              {AGENT_PRO.proAdds.map((l) => <li key={l} className="flex items-start gap-2.5">{check}{l}</li>)}
            </ul>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-5">Free for 14 days, no card needed. Then Agent Pro is $19 a month.</p>
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
          <Link href="/get-started" className="px-7 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10">Start a free 14-day trial</Link>
          <Link href="/pricing#agents" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">See agent pricing</Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
