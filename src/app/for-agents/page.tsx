import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';
import AgentPlanCards from '@/components/marketing/AgentPlanCards';
import { AgentDashboardMockup } from '@/components/marketing/ProductMockups';
import { DealFlowIllustration, AutomationFlowIllustration } from '@/components/marketing/Illustrations';

const FEATURES: { title: string; body: string }[] = [
  { title: 'Contracts, read for you', body: 'Upload the signed contract. AI fills in the address, price, parties and key dates, and you check and save.' },
  { title: 'A checklist on every deal', body: 'Each deal starts with a closing checklist. Due dates follow the contract and move when the dates move.' },
  { title: 'Dates on your calendar', body: 'Google Calendar updates within seconds. Outlook and Apple subscribe with a private link.' },
  { title: 'Documents with the step', body: 'Upload documents against the checklist step they belong to, and share only the ones you choose.' },
  { title: 'Listings, offers and showings', body: 'Each listing has its own page. Turn it into a transaction in one click when an offer is accepted.' },
  { title: 'A live page for your client', body: 'Give your buyer or seller a progress page that shows only the steps and documents you pick.' },
  { title: 'Ready-made emails and forms', body: 'Start from templates for common emails and documents, and edit them for your own wording.' },
  { title: 'Invoices and import', body: 'Keep invoices next to the deal, move them to QuickBooks, and bring your open deals in from a spreadsheet.' },
];

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

      <section className="max-w-5xl mx-auto px-6 pb-16">
        <AgentDashboardMockup />
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-16">
        <DealFlowIllustration />
        <p className="text-xs text-slate-500 mt-3 text-center">One deal, from the contract to closing day.</p>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-700">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">What you get</p>
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Everything about a deal, in one place.</h2>
        <p className="text-slate-400 mb-8 max-w-2xl">No more digging through email, texts and folders to find a date, a document or what is still waiting on someone.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
              <h3 className="font-semibold text-slate-100 mb-2">{f.title}</h3>
              <p className="text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-16 border-t border-slate-700">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-3">Automations, on Pro</p>
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-3">Write the reminder once. Relay sends it every time.</h2>
        <p className="text-slate-400 mb-8 max-w-3xl">You choose what should trigger it, such as a new deal or a date getting close, and which email template to use. When that happens, Relay sends the email to the people on the deal for you. One switch in Settings pauses everything.</p>
        <AutomationFlowIllustration />
        <p className="text-sm text-slate-400 mt-6 max-w-3xl">Starter has ready-made email and document templates you can edit and use by hand, plus your brokerage’s shared templates if it uses Relay. Pro adds the automations and custom checklist templates.</p>
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

      <section className="max-w-4xl mx-auto px-6 py-16 border-t border-slate-700">
        <h2 className="font-display text-3xl font-semibold text-slate-100 mb-8">Questions agents ask</h2>
        <dl className="space-y-6">
          {[
            { q: 'Do I need a brokerage to use Relay?', a: 'No. Sign up on your own with Starter or Pro. If your brokerage already uses Relay, you can also be invited by them.' },
            { q: 'What happens after the 14 days?', a: 'Starter continues at $19 a month. You add a payment method to keep creating and editing, and your deals stay put.' },
            { q: 'Can I work with a coordinator?', a: 'Yes. If your coordinator has a Relay account, you can collaborate with them directly on the same deals.' },
            { q: 'Who can see my deals?', a: 'You do. If your brokerage invited you, your broker can also see where your deals stand. Your clients see only what you share.' },
          ].map((x) => (
            <div key={x.q}>
              <dt className="font-semibold text-slate-100 mb-1">{x.q}</dt>
              <dd className="text-sm text-slate-400">{x.a}</dd>
            </div>
          ))}
        </dl>
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
