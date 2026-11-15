import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import DemoRequestButton from '@/components/DemoRequestButton';
import { BROKERAGE_TIERS, PILOT } from '@/lib/marketingPricing';
import { BrokerageDashboardIllustration } from '@/components/marketing/Illustrations';

const STEPS: { title: string; body: string }[] = [
  { title: 'Start the pilot', body: 'Tell us about your brokerage. We turn on 30 days of Brokerage Pro, with no card needed.' },
  { title: 'Invite your agents', body: 'Add their emails. Each agent gets a workspace at no cost to them, and it counts against your agents included.' },
  { title: 'See every file', body: 'Your dashboard shows open deals, late items and closings this week for the whole roster, and flags missing documents.' },
  { title: 'Choose a plan', body: 'Stay on Pro, drop to Basic, or stop. Nothing renews by itself.' },
];

const check = <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>;
const soon = <span className="w-1.5 h-1.5 rounded-full bg-slate-500 mt-2 flex-shrink-0" />;

export default function ForBrokeragesPage() {
  const { basic, pro, extraAgent } = BROKERAGE_TIERS;
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader active="/for-brokerages" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-12 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">For brokerages</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Every agent, every file, <span className="italic text-blue-400">one view.</span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
          Give your agents a workspace for their deals and listings, and see what is happening across the brokerage without chasing anyone for a status.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <DemoRequestButton className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10" label="Start a free 30-day pilot" />
          <Link href="#plans" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">See plans</Link>
        </div>
        <p className="text-xs text-slate-500 mt-5">{PILOT}</p>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-16"><BrokerageDashboardIllustration /><p className="text-xs text-slate-500 mt-3 text-center">Illustration of the dashboard. Names and numbers are made up.</p></section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-10">How it works</h2>
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

      <section id="plans" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Plans for brokerages</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">One price covers the brokerage and the agents you include. Your agents pay nothing. Need more agents? {extraAgent} a month each, on either plan.</p>
        <div className="grid md:grid-cols-2 gap-6">
          {[basic, pro].map((t, i) => (
            <div key={t.name} className={`rounded-2xl border p-7 flex flex-col ${i === 1 ? 'border-blue-500 bg-slate-700 ring-2 ring-blue-500/20' : 'border-slate-700 bg-slate-800/60'}`}>
              <h3 className="font-display text-2xl font-semibold text-slate-100 mb-1">{t.name}</h3>
              <p className="text-sm text-slate-400 mb-4">{t.blurb}</p>
              <p className="mb-1"><span className="text-4xl font-display font-semibold text-slate-100">{t.price}</span><span className="text-slate-400 ml-1">{t.period}</span></p>
              <p className="text-sm text-slate-300 mb-6">Includes {t.agents} agents</p>
              <ul className="space-y-2.5 text-sm text-slate-300">
                {t.built.map((l) => <li key={l} className="flex items-start gap-2.5">{check}{l}</li>)}
              </ul>
              {'rollingOut' in t && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-6 mb-2">Rolling out during the pilot</p>
                  <ul className="space-y-2.5 text-sm text-slate-400">{t.rollingOut.map((l) => <li key={l} className="flex items-start gap-2.5">{soon}{l}</li>)}</ul>
                </>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-5">Plans start after the pilot. Until then, nothing is billed.</p>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">See it with your own roster.</h2>
        <p className="text-slate-400 mb-6">Start the pilot, invite a few agents, and judge it on real files.</p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <DemoRequestButton className="px-7 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10" label="Start a free 30-day pilot" />
          <Link href="/pricing#brokerages" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">See all pricing</Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
