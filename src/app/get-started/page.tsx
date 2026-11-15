import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import DemoRequestButton from '@/components/DemoRequestButton';
import { AGENT_SELF_SERVE_PUBLIC } from '@/lib/agentSelfServe';

const card = 'rounded-2xl border border-slate-700 bg-slate-800/60 p-7 flex flex-col';
const primary = 'mt-auto block text-center px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition';

export default function GetStartedPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-10 text-center">
        <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-slate-100 mb-4">How will you use Relay?</h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto">Pick the one that fits. Each starts free, and none needs a card.</p>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="grid md:grid-cols-3 gap-6">
          <div className={card}>
            <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">TC</p>
            <h2 className="font-display text-2xl font-semibold text-slate-100 mb-2">Free for 14 days</h2>
            <p className="text-sm text-slate-400 mb-6">Create your account and start with your own transactions and listings right away.</p>
            <Link href="/auth?mode=signup&plan=starter" className={primary}>Start the TC trial</Link>
            <Link href="/for-tcs" className="mt-3 text-center text-sm text-slate-400 hover:text-slate-200">What TCs get</Link>
          </div>

          <div className={card}>
            <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Agent</p>
            <h2 className="font-display text-2xl font-semibold text-slate-100 mb-2">Free for 14 days</h2>
            <p className="text-sm text-slate-400 mb-6">Your own workspace for your own transactions and listings. If your brokerage uses Relay, you may already be covered.</p>
            {AGENT_SELF_SERVE_PUBLIC ? (
              <Link href="/auth?mode=signup&plan=starter&as=agent" className={primary}>Start the agent trial</Link>
            ) : (
              <DemoRequestButton className={primary} label="Start the agent trial" />
            )}
            <Link href="/for-agents" className="mt-3 text-center text-sm text-slate-400 hover:text-slate-200">What agents get</Link>
          </div>

          <div className={card}>
            <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Brokerage</p>
            <h2 className="font-display text-2xl font-semibold text-slate-100 mb-2">Free 30-day pilot</h2>
            <p className="text-sm text-slate-400 mb-6">Tell us about your brokerage and we turn on 30 days of Brokerage Pro, with no card needed.</p>
            <DemoRequestButton className={primary} label="Start a free 30-day pilot" />
            <Link href="/for-brokerages" className="mt-3 text-center text-sm text-slate-400 hover:text-slate-200">What brokerages get</Link>
          </div>
        </div>
        <p className="text-center text-sm text-slate-500 mt-8">Already have an account? <Link href="/auth" className="text-blue-400 hover:text-blue-300">Sign in</Link></p>
      </section>

      <PublicFooter />
    </div>
  );
}
