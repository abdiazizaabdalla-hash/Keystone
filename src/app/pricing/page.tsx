import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import DemoRequestButton from '@/components/DemoRequestButton';
import { PUBLIC_PLANS } from '@/lib/plans';
import { AGENT_PRO, BROKERAGE_TIERS, PILOT } from '@/lib/marketingPricing';
import { WhoPaysIllustration } from '@/components/marketing/Illustrations';

type Cell = boolean | string;
const COMPARISON_ROWS: { feature: string; starter: Cell; pro: Cell; team: Cell }[] = [
  { feature: 'Unlimited transactions', starter: true, pro: true, team: true },
  { feature: 'AI contract intake (creates the transaction or listing for you)', starter: true, pro: true, team: true },
  { feature: 'Checklists with configurable due dates', starter: true, pro: true, team: true },
  { feature: 'Document and email templates', starter: true, pro: true, team: true },
  { feature: 'Listings, offers and showings', starter: true, pro: true, team: true },
  { feature: 'Documents, e-signature and deal email', starter: true, pro: true, team: true },
  { feature: 'Invoicing, other invoices and archive', starter: true, pro: true, team: true },
  { feature: 'Agent profiles', starter: 'Up to 3', pro: 'Unlimited', team: 'Unlimited' },
  { feature: 'Custom checklist templates', starter: false, pro: true, team: true },
  { feature: 'Automations (reminders and follow-ups that run for you)', starter: false, pro: true, team: true },
  { feature: 'Admin dashboard', starter: false, pro: true, team: true },
  { feature: 'Team board, direct messages and shared contacts', starter: false, pro: false, team: true },
  { feature: 'Owner status report across the team', starter: false, pro: false, team: true },
  { feature: 'Seats', starter: '1', pro: '1', team: '3 included' },
];

function Mark({ value }: { value: Cell }) {
  if (typeof value === 'string') return <span className="text-slate-200">{value}</span>;
  if (value) return <svg className="w-5 h-5 text-blue-400 mx-auto" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>;
  return <span className="text-slate-600">—</span>;
}

export default function PricingPage() {
  const { basic, pro, extraAgent } = BROKERAGE_TIERS;
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader active="/pricing" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-10 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Pricing</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">One product, priced for who you are.</h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">Pick the row that describes you. Each one is separate, so you only ever read your own prices.</p>
        <nav className="flex flex-wrap items-center justify-center gap-3 text-sm">
          <a href="#coordinators" className="px-4 py-2 rounded-full border border-slate-700 text-slate-200 hover:border-slate-500 transition">I’m a coordinator</a>
          <a href="#agents" className="px-4 py-2 rounded-full border border-slate-700 text-slate-200 hover:border-slate-500 transition">I’m an agent</a>
          <a href="#brokerages" className="px-4 py-2 rounded-full border border-slate-700 text-slate-200 hover:border-slate-500 transition">I run a brokerage</a>
        </nav>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-16"><WhoPaysIllustration /></section>

      <section id="coordinators" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-2">TCs and teams</h2>
        <p className="text-slate-400 mb-8">Free for 14 days, no card needed. Templates are on every plan. Automations are on Pro and Team.</p>
        <div className="grid md:grid-cols-3 gap-6">
          {PUBLIC_PLANS.map((plan) => (
            <div key={plan.id} className={`rounded-xl border p-8 flex flex-col ${plan.popular ? 'border-blue-500 bg-slate-700 ring-2 ring-blue-500/20' : 'border-slate-700 bg-slate-800/60'}`}>
              <h3 className="font-display text-2xl font-semibold text-slate-100 mb-2">{plan.name}</h3>
              <p className="text-sm text-slate-400 mb-6 min-h-[2.5rem]">{plan.description}</p>
              <p className="mb-6"><span className="text-4xl font-display font-semibold text-slate-100">{plan.price}</span><span className="text-slate-400 ml-1">{plan.period}</span></p>
              <Link href={`/auth?mode=signup&plan=${plan.id}`} className={`block text-center py-3 rounded-lg font-semibold transition mb-8 ${plan.popular ? 'bg-blue-500 hover:bg-blue-400 text-white' : 'border border-slate-600 text-slate-200 hover:border-slate-500'}`}>
                {plan.id === 'starter' ? 'Start free' : `Start ${plan.name}`}
              </Link>
              <ul className="space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-slate-500 mt-8">
          Team is $89 a month with three seats, then $30 a month for each extra seat. <Link href="/for-tcs#teams" className="text-blue-400 hover:text-blue-300">How teams work →</Link>
        </p>

        <div className="overflow-x-auto rounded-xl border border-slate-700 mt-12">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/80 border-b border-slate-700">
                <th className="text-left font-medium text-slate-300 px-5 py-4">Feature</th>
                <th className="font-medium text-slate-300 px-5 py-4">Starter</th>
                <th className="font-medium text-slate-300 px-5 py-4">Pro</th>
                <th className="font-medium text-slate-300 px-5 py-4">Team</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row, i) => (
                <tr key={row.feature} className={i % 2 === 0 ? 'bg-slate-800/30' : ''}>
                  <td className="text-left text-slate-300 px-5 py-3.5 border-t border-slate-700/60">{row.feature}</td>
                  <td className="text-center px-5 py-3.5 border-t border-slate-700/60"><Mark value={row.starter} /></td>
                  <td className="text-center px-5 py-3.5 border-t border-slate-700/60"><Mark value={row.pro} /></td>
                  <td className="text-center px-5 py-3.5 border-t border-slate-700/60"><Mark value={row.team} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="agents" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-2">Agents</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">Your own workspace for your own deals. Either your brokerage provides it, or you subscribe to Agent Pro.</p>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-8">
            <h3 className="font-display text-2xl font-semibold text-slate-100 mb-2">Provided by your brokerage</h3>
            <p className="mb-5"><span className="text-4xl font-display font-semibold text-slate-100">$0</span><span className="text-slate-400 ml-1">to you</span></p>
            <ul className="space-y-2.5 text-sm text-slate-300">{AGENT_PRO.includedByBrokerage.map((l) => <li key={l} className="flex items-start gap-2.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />{l}</li>)}</ul>
          </div>
          <div className="rounded-xl border border-blue-500 bg-slate-700 ring-2 ring-blue-500/20 p-8">
            <h3 className="font-display text-2xl font-semibold text-slate-100 mb-2">Agent Pro</h3>
            <p className="mb-5"><span className="text-4xl font-display font-semibold text-slate-100">{AGENT_PRO.price}</span><span className="text-slate-400 ml-1">{AGENT_PRO.period}</span></p>
            <ul className="space-y-2.5 text-sm text-slate-300">
              <li className="flex items-start gap-2.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />Everything in the brokerage-provided workspace</li>
              {AGENT_PRO.proAdds.map((l) => <li key={l} className="flex items-start gap-2.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />{l}</li>)}
            </ul>
            <DemoRequestButton className="mt-6 block w-full text-center py-3 rounded-lg bg-blue-500 hover:bg-blue-400 text-white font-semibold transition" label="Join the Agent Pro pilot" />
          </div>
        </div>
      </section>

      <section id="brokerages" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-2">Brokerages</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">One price for the brokerage and the agents you include. Your agents pay nothing. {PILOT}</p>
        <div className="grid md:grid-cols-2 gap-6">
          {[basic, pro].map((t, i) => (
            <div key={t.name} className={`rounded-xl border p-8 ${i === 1 ? 'border-blue-500 bg-slate-700 ring-2 ring-blue-500/20' : 'border-slate-700 bg-slate-800/60'}`}>
              <h3 className="font-display text-2xl font-semibold text-slate-100 mb-1">{t.name}</h3>
              <p className="mb-1"><span className="text-4xl font-display font-semibold text-slate-100">{t.price}</span><span className="text-slate-400 ml-1">{t.period}</span></p>
              <p className="text-sm text-slate-300 mb-4">Includes {t.agents} agents. Extra agents {extraAgent} a month.</p>
              <p className="text-sm text-slate-400">{t.blurb}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-slate-500"><Link href="/for-brokerages#plans" className="text-blue-400 hover:text-blue-300">See what each brokerage plan includes →</Link></p>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-4">How getting paid works</h2>
        <p className="text-slate-400 mb-3">There are two separate money flows in Relay:</p>
        <ul className="space-y-3 text-sm text-slate-300 mb-4">
          <li className="flex items-start gap-2.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />You pay Relay for your plan, the one you picked above.</li>
          <li className="flex items-start gap-2.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />Agents pay coordinators for invoices. Relay never touches that money.</li>
        </ul>
        <p className="text-slate-400">Take invoice payments through your connected Stripe account, or record payments received another way. Relay charges no platform fee on invoice payments.</p>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">Start where you are</h2>
        <p className="text-slate-400 mb-8">Coordinators start free today. Agents and brokerages start with a pilot.</p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link href="/auth?mode=signup&plan=starter" className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition">Start free as a coordinator</Link>
          <DemoRequestButton className="px-6 py-3 border border-slate-600 text-slate-200 hover:border-slate-500 font-semibold rounded-lg transition" label="Request a demo" />
          <Link href="/faq" className="px-6 py-3 text-slate-300 hover:text-slate-100 font-semibold transition">Read the FAQ</Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
