import Link from 'next/link';
import { PUBLIC_PLANS } from '@/lib/plans';

// Agents are on the same two plans, at the same prices, as every Relay user: Starter and Pro. Read straight from plans.ts so the two never drift apart.
const AGENT_DESCRIPTION: Record<string, string> = {
  starter: 'Free to try, then $19/month. Unlimited transactions.',
  pro: 'For running your transactions in Relay.',
};

export default function AgentPlanCards() {
  const plans = PUBLIC_PLANS.filter((p) => p.id === 'starter' || p.id === 'pro');
  return (
    <div className="grid md:grid-cols-2 gap-6">
      {plans.map((plan) => (
        <div key={plan.id} className={`rounded-xl border p-8 flex flex-col ${plan.popular ? 'border-blue-500 bg-slate-700 ring-2 ring-blue-500/20' : 'border-slate-700 bg-slate-800/60'}`}>
          <h3 className="font-display text-2xl font-semibold text-slate-100 mb-2">{plan.name}</h3>
          <p className="text-sm text-slate-400 mb-6 min-h-[2.5rem]">{AGENT_DESCRIPTION[plan.id] ?? plan.description}</p>
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
  );
}
