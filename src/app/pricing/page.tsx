'use client';

import Link from 'next/link';
import { PLANS } from '@/lib/plans';

const CTA_LABELS: Record<string, string> = {
  starter: 'Start free',
  pro: 'Start Pro',
  team: 'Start Team',
};

const UPGRADE_REASONS = [
  'You want every deal to run through Relay instead of only your biggest closings.',
  'You’re working with more than three agents at once and need more profiles.',
  'You want to build your own checklist templates instead of using the baseline one.',
  'You’re bringing on other coordinators or assistants who need to see the same deals.',
];

type ComparisonValue = boolean | string;

const COMPARISON_ROWS: { feature: string; starter: ComparisonValue; pro: ComparisonValue; team: ComparisonValue }[] = [
  { feature: 'Transaction management', starter: true, pro: true, team: true },
  { feature: 'Baseline checklist', starter: true, pro: true, team: true },
  { feature: 'Custom checklist templates', starter: false, pro: true, team: true },
  { feature: 'Agent profiles (for invoicing)', starter: 'Up to 3', pro: 'Unlimited', team: 'Unlimited' },
  { feature: 'Agent portal invitations', starter: true, pro: true, team: true },
  { feature: 'Document storage & organization', starter: true, pro: true, team: true },
  { feature: 'E-signature requests', starter: true, pro: true, team: true },
  { feature: 'Invoicing & payment tracking', starter: true, pro: true, team: true },
  { feature: 'Google Calendar sync', starter: true, pro: true, team: true },
  { feature: 'Daily deadline digest', starter: true, pro: true, team: true },
  { feature: 'Admin dashboard', starter: false, pro: true, team: true },
  { feature: 'Team roster & shared oversight', starter: false, pro: false, team: true },
];

function ComparisonCell({ value }: { value: ComparisonValue }) {
  if (typeof value === 'string') {
    return <span className="text-slate-200">{value}</span>;
  }
  if (value) {
    return (
      <svg className="w-5 h-5 text-blue-400 mx-auto" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
      </svg>
    );
  }
  return <span className="text-slate-600">—</span>;
}

export default function PricingPage() {
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
            <Link href="/pricing" className="text-slate-100">Pricing</Link>
            <Link href="/faq" className="hover:text-slate-100 transition">FAQ</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link
              href="/agent/login"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-500/40 bg-blue-500/10 text-sm text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 transition"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              Agent Login
            </Link>
            <Link href="/auth" className="text-sm text-slate-300 hover:text-slate-100 transition">Sign In</Link>
            <Link
              href="/auth?mode=signup&plan=starter"
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* Header */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Pricing</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Simple pricing for every stage of your TC business.
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto">
          Start with the tools you need today. Upgrade for custom workflows or team collaboration as your business grows.
        </p>
      </section>

      {/* Plans */}
      <section className="max-w-6xl mx-auto px-6 pb-16">
        <div className="grid md:grid-cols-3 gap-6">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-xl border p-8 flex flex-col ${
                plan.popular ? 'border-blue-500 bg-slate-700 ring-2 ring-blue-500/20' : 'border-slate-700 bg-slate-800/60'
              }`}
            >
              {plan.popular && (
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-3">For everyday work</p>
              )}
              <h2 className="font-display text-2xl font-semibold text-slate-100 mb-2">{plan.name}</h2>
              <p className="text-sm text-slate-400 mb-6 min-h-[2.5rem]">{plan.description}</p>
              <div className="mb-6">
                <span className="text-4xl font-display font-semibold text-slate-100">{plan.price}</span>
                <span className="text-slate-400 ml-1">{plan.period}</span>
              </div>
              <Link
                href={`/auth?mode=signup&plan=${plan.id}`}
                className={`block text-center py-3 rounded-lg font-semibold transition mb-8 ${
                  plan.popular
                    ? 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white'
                    : 'border border-slate-600 text-slate-200 hover:border-slate-500'
                }`}
              >
                {CTA_LABELS[plan.id] || `Start ${plan.name}`}
              </Link>
              <ul className="space-y-3 mt-auto">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-slate-500 mt-8">
          Team is billed at $19 per TC seat per month, with a three-seat minimum ($57/month to start). Agents invited to collaborate on transactions do not require paid TC seats — the agent portal is free on every plan.
        </p>
      </section>

      {/* Comparison table */}
      <section className="max-w-5xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-8 text-center">Compare plans</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-700">
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
                <tr key={row.feature} className={i % 2 === 0 ? 'bg-slate-800/30' : 'bg-transparent'}>
                  <td className="text-left text-slate-300 px-5 py-3.5 border-t border-slate-700/60">{row.feature}</td>
                  <td className="text-center px-5 py-3.5 border-t border-slate-700/60"><ComparisonCell value={row.starter} /></td>
                  <td className="text-center px-5 py-3.5 border-t border-slate-700/60"><ComparisonCell value={row.pro} /></td>
                  <td className="text-center px-5 py-3.5 border-t border-slate-700/60"><ComparisonCell value={row.team} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Payments clarification */}
      <section className="max-w-4xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-4">How getting paid works</h2>
        <p className="text-slate-400 mb-3">
          There are two separate money flows in Relay, and it&apos;s worth being clear about both:
        </p>
        <ul className="space-y-3 text-sm text-slate-300 mb-4">
          <li className="flex items-start gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
            You pay Relay for your subscription — that&apos;s the plan you pick above.
          </li>
          <li className="flex items-start gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
            Your agents pay you for your invoices — Relay never touches that money.
          </li>
        </ul>
        <p className="text-slate-400">
          Accept invoice payments through your connected Stripe account, or record payments
          received through your preferred payment method. Relay charges no platform fee on
          invoice payments.
        </p>
      </section>

      {/* Why upgrade */}
      <section className="max-w-4xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-2">Common reasons TCs upgrade</h2>
        <p className="text-slate-400 mb-10">Most upgrades happen once Relay becomes part of the regular closing process.</p>
        <ul className="space-y-5">
          {UPGRADE_REASONS.map((reason) => (
            <li key={reason} className="flex items-start gap-3 text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
              {reason}
            </li>
          ))}
        </ul>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-4">
          Start on Starter, upgrade when it sticks
        </h2>
        <p className="text-slate-400 mb-8">The easiest way to see if Relay saves your team the back-and-forth it&apos;s meant to save.</p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link
            href="/auth?mode=signup&plan=starter"
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition"
          >
            Start free
          </Link>
          <Link href="/faq" className="px-6 py-3 border border-slate-600 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">
            Read the FAQ
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/relay-icon.png" alt="Relay TC" className="w-6 h-6 object-contain" />
            <span className="text-sm text-slate-400">Relay TC</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <Link href="/" className="hover:text-slate-200 transition">Home</Link>
            <Link href="/faq" className="hover:text-slate-200 transition">FAQ</Link>
            <Link href="/auth" className="hover:text-slate-200 transition">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
