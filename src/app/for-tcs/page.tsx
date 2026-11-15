import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import DemoRequestButton from '@/components/DemoRequestButton';
import { PUBLIC_PLANS } from '@/lib/plans';
import { PRESETS } from '@/lib/automation/presets';
import { DealFlowIllustration, PortalIllustration, TeamIllustration } from '@/components/marketing/Illustrations';

const FEATURES: { title: string; body: string }[] = [
  { title: 'Start with the contract', body: 'Upload the purchase agreement and Relay fills in the deal: address, price, parties and key dates. You review, then save.' },
  { title: 'Checklists with due dates', body: 'A checklist for every deal, due dates set by rule, and a ready-to-send email on each step. Build your own checklist templates on Pro and Team.' },
  { title: 'Every deadline tracked', body: 'Critical dates on one calendar, reminders before each is due, and what needs you today at the top of your dashboard.' },
  { title: 'Listings to closing', body: 'Listing intake, offers and showings, then convert to a transaction in one click.' },
  { title: 'A page for every deal', body: 'Documents by category, e-signature, a deal email address and a message thread for the agent.' },
  { title: 'Invoicing with the deal', body: 'Invoice the agent when you close, or send any other invoice. Stripe payments, manual and Zelle recording, and QuickBooks import and export.' },
  { title: 'Archive, don’t clutter', body: 'Closed and cancelled files move to the archive and come back with one click.' },
  { title: 'Move over in an afternoon', body: 'Import your current deals from a spreadsheet and keep your own checklist order.' },
];

const PORTAL_POINTS = [
  'Your agents sign in free. You pay nothing extra for them, and they never use one of your seats.',
  'They see only the deals and listings you choose. Tick or untick each one from the Agents page.',
  'On a deal they follow the checklist, key dates and documents, upload files, and message you.',
  'They can share a live progress page with their buyer or seller, with only what they choose to show.',
  'A new deal for an agent who already has a login is added for you. Untick the box if you would rather not.',
];

const TEAM_STEPS: { title: string; body: string }[] = [
  { title: 'Start Team', body: 'Pick the Team plan. Three seats are included, so you can bring in two coordinators right away.' },
  { title: 'Invite your coordinators', body: 'Add their emails from Collaborate. They sign in and land on your team with everything Pro has.' },
  { title: 'Talk and share', body: 'Use the team board and direct messages, and share the lenders, title companies and inspectors everyone uses.' },
  { title: 'Watch the whole pipeline', body: 'The owner downloads a status report of every open file, checklist progress and overdue dates. No client details.' },
];

const check = <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>;

export default function ForTcsPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader active="/for-tcs" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-12 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">For transaction coordinators</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">
          Listing to closing, <span className="italic text-blue-400">all in one workspace.</span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
          Keep listings, offers, checklists, documents, deadlines, agent communication and invoicing together on every deal, so you can take on more files without more chaos.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/auth?mode=signup&plan=starter" className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10">Start free</Link>
          <Link href="#plans" className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition">See plans</Link>
        </div>
        <p className="text-xs text-slate-500 mt-5">Free for 30 days. No credit card required.</p>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-16"><DealFlowIllustration /></section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
              <h2 className="font-semibold text-slate-100 mb-2">{f.title}</h2>
              <p className="text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="templates" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Templates and automations</p>
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Templates for everyone. Automations when you are ready.</h2>
        <p className="text-slate-400 max-w-3xl mb-8">Start with ready-made document and email templates and make them yours. When you want Relay to send the reminder for you, switch on an automation.</p>
        <div className="grid md:grid-cols-2 gap-5">
          <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-6">
            <span className="inline-block text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-400/40 rounded-full px-2.5 py-0.5 mb-3">Every plan, Starter included</span>
            <h3 className="text-lg font-semibold text-slate-100 mb-2">Templates</h3>
            <p className="text-sm text-slate-400">Ready-made emails, letters and forms you can use on a deal, organize in folders and edit. You choose when each one goes out.</p>
          </div>
          <div className="bg-slate-800/60 border border-blue-500/40 rounded-2xl p-6">
            <span className="inline-block text-xs font-semibold text-blue-200 bg-blue-500/15 border border-blue-400/40 rounded-full px-2.5 py-0.5 mb-3">Pro and Team</span>
            <h3 className="text-lg font-semibold text-slate-100 mb-2">Automations</h3>
            <p className="text-sm text-slate-400">{PRESETS.filter((p) => p.category === 'transaction').length} ready-made transaction automations for the moments that matter: new transaction, earnest money, inspection and option period, financing, appraisal, title, closing and post-closing. Switch on the ones you want from the Library, then apply them to a deal. One switch in Settings pauses everything.</p>
          </div>
        </div>
      </section>

      <section id="agent-portal" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Agent portal</p>
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Give your agents a free login, deal by deal.</h2>
        <p className="text-slate-400 max-w-3xl mb-8">Agents you work with can follow their deals without calling you. It costs you and them nothing, and you decide exactly what each agent can see.</p>
        <PortalIllustration />
        <ul className="grid md:grid-cols-2 gap-x-8 gap-y-3 text-sm text-slate-300 mt-8">
          {PORTAL_POINTS.map((p) => <li key={p} className="flex items-start gap-2.5">{check}{p}</li>)}
        </ul>
        <p className="text-sm text-slate-500 mt-6 max-w-3xl">
          This login is for agents who work with you. It lets them work on the deals you give them. An agent who wants a workspace of their own for their own deals can
          see <Link href="/for-agents" className="text-blue-400 hover:text-blue-300">Relay for agents</Link>.
        </p>
      </section>

      <section id="teams" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Teams</p>
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Coordinators who work together, deals that stay private.</h2>
        <p className="text-slate-400 max-w-3xl mb-8">Team is $89 a month and includes three coordinator seats. Each extra seat is $30 a month. Everyone gets everything in Pro, automations included.</p>
        <TeamIllustration />
        <ol className="grid md:grid-cols-4 gap-5 mt-8">
          {TEAM_STEPS.map((s, i) => (
            <li key={s.title} className="bg-slate-800/60 border border-slate-700 rounded-xl p-5">
              <span className="w-8 h-8 rounded-full bg-blue-500 text-white text-sm font-semibold flex items-center justify-center mb-3">{i + 1}</span>
              <h3 className="font-semibold text-slate-100 mb-1.5">{s.title}</h3>
              <p className="text-sm text-slate-400">{s.body}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm text-slate-500 mt-6 max-w-3xl">Each coordinator keeps their own deals, agents and notes private. Teammates see only what you choose to share, and agents you invite never use a seat.</p>
      </section>

      <section id="plans" className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700 scroll-mt-4">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-8 text-center">Plans for coordinators</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {PUBLIC_PLANS.map((plan) => (
            <div key={plan.id} className={`rounded-xl border p-7 flex flex-col ${plan.popular ? 'border-blue-500 bg-slate-700 ring-2 ring-blue-500/20' : 'border-slate-700 bg-slate-800/60'}`}>
              <h3 className="font-display text-xl font-semibold text-slate-100 mb-1">{plan.name}</h3>
              <p className="text-sm text-slate-400 mb-4 min-h-[2.5rem]">{plan.description}</p>
              <p className="mb-5"><span className="text-3xl font-display font-semibold text-slate-100">{plan.price}</span><span className="text-slate-400 ml-1">{plan.period}</span></p>
              <p className="text-sm text-slate-300 mb-5">{plan.id === 'starter' ? 'Templates included. No automations.' : plan.id === 'pro' ? 'Templates and automations.' : 'Templates, automations and a shared team space.'}</p>
              <Link href={`/auth?mode=signup&plan=${plan.id}`} className={`mt-auto block text-center py-2.5 rounded-lg font-semibold transition ${plan.popular ? 'bg-blue-500 hover:bg-blue-400 text-white' : 'border border-slate-600 text-slate-200 hover:border-slate-500'}`}>
                {plan.id === 'starter' ? 'Start free' : `Start ${plan.name}`}
              </Link>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-slate-500 mt-6"><Link href="/pricing#coordinators" className="text-blue-400 hover:text-blue-300">Compare every feature →</Link></p>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-20 border-t border-slate-700 text-center">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-6">Run your next closing in Relay.</h2>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/auth?mode=signup&plan=starter" className="px-7 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition shadow-lg shadow-blue-500/10">Start free</Link>
          <DemoRequestButton className="px-6 py-3 border border-slate-700 hover:border-slate-600 text-slate-200 font-semibold rounded-lg transition" label="Request a demo" />
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
