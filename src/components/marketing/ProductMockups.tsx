// Marketing recreations of Relay screens, built from the same layout as the app (sidebar, tiles, lists) so the site shows the product
// rather than stock art. Everything here is made-up data. Brokerage workflow publishing and shared templates match what is built;
// nothing in this file depicts an integration or feature that does not exist. Server components, no images, nothing to load.

type Tone = 'blue' | 'emerald' | 'amber' | 'red' | 'slate';
const TONE: Record<Tone, string> = {
  blue: 'bg-blue-500/15 text-blue-300 border-blue-400/30',
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  red: 'bg-red-500/15 text-red-300 border-red-400/30',
  slate: 'bg-slate-500/15 text-slate-300 border-slate-400/30',
};
const WIN = 'rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-black/40 overflow-hidden text-left';
const PANEL = 'rounded-xl border border-white/10 bg-white/[0.04] p-3';

function Chip({ tone = 'slate', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${TONE[tone]}`}>{children}</span>;
}
function Bar({ pct, tone = 'blue' }: { pct: number; tone?: 'blue' | 'emerald' | 'amber' }) {
  const c = tone === 'emerald' ? 'bg-emerald-400' : tone === 'amber' ? 'bg-amber-400' : 'bg-blue-500';
  return <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden"><div className={`h-full ${c}`} style={{ width: `${pct}%` }} /></div>;
}
function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={PANEL}>
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={`text-xl font-bold leading-tight ${tone ?? 'text-blue-300'}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  );
}
function Title({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return <div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold text-slate-100">{children}</p>{right}</div>;
}
function Chrome({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={WIN}>
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/10 bg-slate-950/60">
        <span className="w-2 h-2 rounded-full bg-slate-600" /><span className="w-2 h-2 rounded-full bg-slate-600" /><span className="w-2 h-2 rounded-full bg-slate-600" />
        <span className="ml-2 text-[10px] text-slate-500">{label}</span>
      </div>
      {children}
    </div>
  );
}
function Rail({ items, active, heading }: { items: string[]; active: string; heading?: string }) {
  return (
    <div className="hidden sm:block w-28 shrink-0 border-r border-white/10 bg-slate-950/50 p-2 space-y-0.5">
      {heading && <p className="px-2 pb-1 text-[9px] uppercase tracking-wider text-slate-500">{heading}</p>}
      {items.map((i) => (
        <div key={i} className={`px-2 py-1.5 rounded-lg text-[11px] ${i === active ? 'bg-blue-500/20 text-white ring-1 ring-blue-400/30' : 'text-slate-400'}`}>{i}</div>
      ))}
    </div>
  );
}
function Deal({ addr, stage, tone, pct, close, who }: { addr: string; stage: string; tone: Tone; pct: number; close: string; who?: string }) {
  return (
    <div className={PANEL}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="text-xs font-semibold text-slate-100 truncate">{addr}</p>{who && <p className="text-[10px] text-slate-500">{who}</p>}</div>
        <Chip tone={tone}>{stage}</Chip>
      </div>
      <div className="mt-2"><Bar pct={pct} tone={tone === 'amber' ? 'amber' : tone === 'emerald' ? 'emerald' : 'blue'} /></div>
      <div className="flex justify-between mt-1.5 text-[10px] text-slate-500"><span>{pct}% of checklist</span><span>Closes {close}</span></div>
    </div>
  );
}
function Task({ text, due, tone = 'slate' }: { text: string; due: string; tone?: Tone }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
      <span className="w-3.5 h-3.5 rounded border border-slate-500 shrink-0" />
      <span className="text-[11px] text-slate-200 flex-1 truncate">{text}</span>
      <Chip tone={tone}>{due}</Chip>
    </div>
  );
}
export function MockupCaption({ children = 'Illustration of the Relay workspace. Names, addresses and numbers are made up.' }: { children?: React.ReactNode }) {
  return <p className="text-[11px] text-slate-500 mt-3 text-center">{children}</p>;
}

/** Hero: the unified workspace, with a quiet nod to brokerage visibility. */
export function HeroWorkspaceMockup() {
  return (
    <div className="relative">
      <Chrome label="relaytc.com / dashboard">
        <div className="flex">
          <Rail items={['Home', 'Transactions', 'Listings', 'Calendar', 'Messages', 'Invoices', 'Automations']} active="Home" />
          <div className="flex-1 min-w-0 p-3 space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <Stat label="Active transactions" value="14" sub="$5.8M pipeline" />
              <Stat label="Active listings" value="6" sub="2 with offers" />
              <Stat label="Closing this week" value="3" tone="text-emerald-300" />
              <Stat label="Needs attention" value="2" tone="text-amber-300" />
            </div>
            <div className="grid md:grid-cols-[3fr_2fr] gap-3">
              <div className="space-y-2">
                <Title right={<span className="text-[10px] text-blue-300">View all</span>}>Transactions</Title>
                <Deal addr="412 Larkspur Lane" stage="Under contract" tone="blue" pct={67} close="Dec 12" />
                <Deal addr="88 Harbor View Dr" stage="Inspection" tone="amber" pct={42} close="Dec 20" />
                <Deal addr="1209 Elm Court" stage="Clear to close" tone="emerald" pct={91} close="Dec 3" />
              </div>
              <div className="space-y-2">
                <div className={PANEL}>
                  <Title>Due today</Title>
                  <Task text="Confirm earnest money" due="Today" tone="red" />
                  <Task text="Order title commitment" due="Tomorrow" tone="amber" />
                  <Task text="Send inspection notice" due="Dec 4" />
                </div>
                <div className={PANEL}>
                  <Title>Automation activity</Title>
                  <p className="text-[11px] text-slate-300">Reminder sent to the buyer’s agent for 412 Larkspur Lane</p>
                  <p className="text-[10px] text-slate-500 mt-1">2 minutes ago</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Chrome>
      <div className="hidden md:block absolute -bottom-5 -right-3 w-56 rounded-xl border border-blue-400/30 bg-slate-900 shadow-xl shadow-black/50 p-3">
        <p className="text-[9px] uppercase tracking-wider text-blue-300 mb-1">Brokerage view</p>
        <p className="text-xs text-slate-100 font-semibold">38 agents · 142 open files</p>
        <p className="text-[10px] text-slate-400">9 closing this week, 6 need attention</p>
      </div>
    </div>
  );
}

/** An agent's own business: their deals, listings and what is next. */
export function AgentDashboardMockup() {
  return (
    <Chrome label="Agent workspace">
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between"><p className="text-sm font-semibold text-slate-100">Your business</p><Chip tone="blue">3 closings this month</Chip></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Title>My transactions</Title>
            <Deal addr="31 Willow Bend" stage="Under contract" tone="blue" pct={58} close="Dec 15" />
            <Deal addr="905 Cedar Ridge" stage="Appraisal" tone="amber" pct={74} close="Dec 9" />
          </div>
          <div className="space-y-2">
            <Title>My listings</Title>
            {[['77 Orchard Way', '$524,900', 'Active', 'emerald', '2 offers, 4 showings'], ['14 Bayfront Ct', '$689,000', 'Coming soon', 'slate', 'Lists Dec 6']].map(([a, p, s, t, n]) => (
              <div key={a} className={PANEL}>
                <div className="flex justify-between"><p className="text-xs font-semibold text-slate-100">{a}</p><Chip tone={t as Tone}>{s}</Chip></div>
                <p className="text-sm font-bold text-blue-300">{p}</p><p className="text-[10px] text-slate-500">{n}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className={PANEL}><Title>Pending tasks</Title><Task text="Send disclosures to buyer" due="Today" tone="red" /><Task text="Review repair request" due="Dec 5" tone="amber" /></div>
          <div className={PANEL}><Title>Contacts on 31 Willow Bend</Title><p className="text-[11px] text-slate-300">Lender · Title company · Inspector</p><p className="text-[10px] text-slate-500 mt-1">A workflow started the welcome email for the buyer</p></div>
        </div>
      </div>
    </Chrome>
  );
}

/** A coordinator running many files for many agents, with a team behind them. */
export function CoordinatorWorkspaceMockup() {
  const rows: [string, string, string, string, number, Tone][] = [
    ['412 Larkspur Lane', 'M. Rivera', 'Order title commitment', 'Today', 67, 'red'],
    ['88 Harbor View Dr', 'J. Okafor', 'Inspection response', 'Dec 4', 42, 'amber'],
    ['1209 Elm Court', 'M. Rivera', 'Final walkthrough', 'Dec 2', 91, 'emerald'],
    ['50 Pine Hollow', 'S. Lindqvist', 'Appraisal ordered', 'Dec 6', 33, 'slate'],
    ['218 Maple Row', 'J. Okafor', 'Loan commitment', 'Dec 9', 58, 'slate'],
  ];
  return (
    <Chrome label="Coordinator workspace">
      <div className="flex">
        <Rail items={['Home', 'Transactions', 'Listings', 'Calendar', 'Contacts', 'Invoices', 'Automations']} active="Transactions" />
        <div className="flex-1 min-w-0 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-100">All active files · 14</p>
            <div className="flex -space-x-1.5">{['AB', 'CD', 'EF'].map((i) => <span key={i} className="w-6 h-6 rounded-full bg-blue-500/25 border border-slate-900 text-[9px] text-blue-100 flex items-center justify-center">{i}</span>)}</div>
          </div>
          <div className={`${PANEL} p-0 overflow-hidden`}>
            <div className="grid grid-cols-[2fr_1.2fr_2fr_0.8fr_1fr] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5"><span>Property</span><span>Agent</span><span>Next step</span><span>Due</span><span>Progress</span></div>
            {rows.map(([a, ag, step, due, pct, t]) => (
              <div key={a} className="grid grid-cols-[2fr_1.2fr_2fr_0.8fr_1fr] gap-2 items-center px-3 py-2 text-[11px] border-b border-white/5 last:border-0">
                <span className="text-slate-100 truncate">{a}</span><span className="text-slate-400 truncate">{ag}</span><span className="text-slate-300 truncate">{step}</span>
                <span><Chip tone={t}>{due}</Chip></span><Bar pct={pct} />
              </div>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className={PANEL}><Title>Checklist · 412 Larkspur Lane</Title><Task text="Earnest money received" due="Done" tone="emerald" /><Task text="Title commitment ordered" due="Today" tone="red" /></div>
            <div className={PANEL}><Title>Automations running</Title><p className="text-[11px] text-slate-300">New transaction checklist</p><p className="text-[11px] text-slate-300">Closing reminders, 7 and 2 days out</p></div>
          </div>
        </div>
      </div>
    </Chrome>
  );
}

/** The brokerage layer: roster and oversight on top, workflow publishing alongside. */
export function BrokerageDashboardMockup() {
  const agents: [string, number, number, Tone][] = [['M. Rivera', 6, 0, 'emerald'], ['J. Okafor', 9, 2, 'amber'], ['S. Lindqvist', 4, 0, 'emerald'], ['T. Nwosu', 7, 1, 'amber']];
  return (
    <Chrome label="Brokerage oversight">
      <div className="flex">
        <Rail heading="Brokerage" items={['Overview', 'Agents', 'Compliance', 'Reports', 'Automations']} active="Overview" />
        <div className="flex-1 min-w-0 p-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Stat label="Agents" value="38" sub="2 invited" />
            <Stat label="Open deals" value="142" sub="$61M pipeline" />
            <Stat label="Open listings" value="57" sub="$38M listed" />
            <Stat label="Closing this week" value="9" tone="text-emerald-300" />
            <Stat label="Needs attention" value="6" tone="text-amber-300" />
          </div>
          <div className="grid md:grid-cols-[3fr_2fr] gap-3">
            <div className={PANEL}>
              <Title>Agent workspaces</Title>
              {agents.map(([n, d, a, t]) => (
                <div key={n} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0 text-[11px]">
                  <span className="text-slate-100">{n}</span><span className="text-slate-400">{d} open deals</span>
                  <Chip tone={t}>{a === 0 ? 'On track' : `${a} need attention`}</Chip>
                </div>
              ))}
              <p className="text-[10px] text-slate-500 mt-2">Each agent keeps their own workspace. You see where files stand, not their private messages.</p>
            </div>
            <div className="space-y-3">
              <div className={PANEL}>
                <Title right={<Chip tone="emerald">Published</Chip>}>Workflow for all agents</Title>
                <p className="text-[11px] text-slate-200">New transaction onboarding</p>
                <p className="text-[10px] text-slate-500">Checklist, welcome email, title order task</p>
                <p className="text-[10px] text-blue-300 mt-1.5">Available to 38 agents</p>
              </div>
              <div className={PANEL}>
                <Title>Closing soon</Title>
                <p className="text-[11px] text-slate-300">1209 Elm Court · Dec 3</p><p className="text-[11px] text-slate-300">412 Larkspur Lane · Dec 12</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Chrome>
  );
}

/** One transaction, contract to closing. */
export function TransactionWorkspaceMockup() {
  const steps: [string, string, 'done' | 'now' | 'next'][] = [['Contract executed', 'Nov 14', 'done'], ['Earnest money', 'Nov 17', 'done'], ['Inspection period', 'Nov 24', 'now'], ['Appraisal', 'Dec 2', 'next'], ['Clear to close', 'Dec 9', 'next'], ['Closing', 'Dec 12', 'next']];
  return (
    <div className="relative">
      <Chrome label="412 Larkspur Lane · Under contract">
        <div className="flex">
          <Rail items={['Overview', 'Checklist', 'Documents', 'Messages', 'Contacts', 'Invoice']} active="Overview" />
          <div className="flex-1 min-w-0 p-3 grid md:grid-cols-[3fr_2fr] gap-3">
            <div className="space-y-3">
              <div className={PANEL}>
                <Title right={<span className="text-[10px] text-slate-500">Purchase $415,000</span>}>Milestones</Title>
                <ol className="space-y-2">
                  {steps.map(([n, d, s]) => (
                    <li key={n} className="flex items-center gap-2.5">
                      <span className={`w-3 h-3 rounded-full border ${s === 'done' ? 'bg-emerald-400 border-emerald-400' : s === 'now' ? 'bg-blue-500 border-blue-300 ring-4 ring-blue-500/20' : 'border-slate-600'}`} />
                      <span className={`text-[11px] flex-1 ${s === 'next' ? 'text-slate-500' : 'text-slate-100'}`}>{n}</span><span className="text-[10px] text-slate-500">{d}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className={PANEL}><Title>Open tasks</Title><Task text="Collect inspection report" due="Today" tone="red" /><Task text="Send repair request to seller’s agent" due="Nov 25" tone="amber" /><Task text="Confirm appraisal appointment" due="Dec 1" /></div>
            </div>
            <div className="space-y-3">
              <div className={PANEL}><Title>Contacts</Title>{['Buyer’s agent', 'Lender', 'Title company', 'Inspector'].map((c) => <p key={c} className="text-[11px] text-slate-300 py-0.5">{c}</p>)}</div>
              <div className={PANEL}><Title>Documents</Title><p className="text-[11px] text-slate-300">Purchase contract · signed</p><p className="text-[11px] text-slate-300">Inspection report · uploaded</p><p className="text-[11px] text-slate-500">Lender letter · waiting</p></div>
            </div>
          </div>
        </div>
      </Chrome>
      <div className="hidden md:block absolute -top-4 -right-3 w-52 rounded-xl border border-blue-400/30 bg-slate-900 shadow-xl shadow-black/50 p-3">
        <p className="text-[9px] uppercase tracking-wider text-blue-300 mb-1">Read from the contract</p>
        <p className="text-[11px] text-slate-200">Address, price, parties and 6 key dates, ready for you to check</p>
      </div>
    </div>
  );
}

/** Listings as their own pipeline, with the accepted offer becoming a transaction. */
export function ListingDashboardMockup() {
  const props: [string, string, string, Tone, string][] = [
    ['77 Orchard Way', '$524,900', 'Active', 'emerald', 'Expires Feb 28 · 2 offers · 4 showings'],
    ['14 Bayfront Ct', '$689,000', 'Coming soon', 'slate', 'Lists Dec 6 · photos Dec 3'],
    ['302 Summit Pl', '$412,500', 'Offer accepted', 'blue', 'Offer $405,000 accepted today'],
  ];
  return (
    <div className="grid md:grid-cols-[3fr_2fr] gap-4 items-stretch">
      <Chrome label="Listings">
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2"><Stat label="Active" value="6" /><Stat label="Offers" value="4" tone="text-amber-300" /><Stat label="Showings this week" value="11" /></div>
          {props.map(([a, p, s, t, n]) => (
            <div key={a} className={`${PANEL} flex items-center gap-3 ${s === 'Offer accepted' ? 'ring-1 ring-blue-400/50' : ''}`}>
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 border border-white/10 shrink-0" />
              <div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="text-xs font-semibold text-slate-100 truncate">{a}</p><Chip tone={t}>{s}</Chip></div><p className="text-sm font-bold text-blue-300">{p}</p><p className="text-[10px] text-slate-500 truncate">{n}</p></div>
            </div>
          ))}
        </div>
      </Chrome>
      <div className="flex md:flex-col items-center justify-center gap-3">
        <div className="hidden md:block h-6 w-px bg-blue-400/40" />
        <span className="text-[10px] uppercase tracking-wider text-blue-300">One click</span>
        <div className="hidden md:block h-6 w-px bg-blue-400/40" />
        <div className="rounded-xl border border-blue-400/40 bg-blue-500/10 p-4 w-full">
          <p className="text-[9px] uppercase tracking-wider text-blue-300 mb-1">New transaction</p>
          <p className="text-sm font-semibold text-slate-100">302 Summit Pl</p>
          <p className="text-[11px] text-slate-300 mt-1">Price $405,000. Parties, dates and the closing checklist carried over from the listing.</p>
        </div>
      </div>
    </div>
  );
}

/** A workflow built from a template or from scratch, with approval before anything is sent. */
export function WorkflowBuilderMockup() {
  const actions = ['Create the closing checklist', 'Assign the first tasks', 'Notify the assigned coordinator', 'Send the welcome email'];
  return (
    <Chrome label="Automations · Workflow builder">
      <div className="p-3 space-y-3">
        <div className={PANEL}>
          <p className="text-[10px] text-slate-500 mb-1.5">Start from a template, or build your own</p>
          <div className="flex flex-wrap gap-1.5">{['New transaction', 'Closing reminder', 'New listing', 'Inspection follow-up'].map((t, i) => <Chip key={t} tone={i === 0 ? 'blue' : 'slate'}>{t}</Chip>)}</div>
        </div>
        <div className="grid md:grid-cols-[3fr_2fr] gap-3">
          <div className={PANEL}>
            <Title right={<Chip tone="amber">You approve each send</Chip>}>New transaction onboarding</Title>
            <div className="rounded-lg border border-blue-400/40 bg-blue-500/10 px-3 py-2 text-[11px] text-blue-100">Trigger: Transaction created</div>
            {actions.map((a, i) => (
              <div key={a}><div className="mx-auto w-px h-3 bg-slate-600" /><div className="rounded-lg border border-white/10 bg-slate-800/70 px-3 py-2 text-[11px] text-slate-200 flex items-center gap-2"><span className="w-4 h-4 rounded-full bg-slate-700 text-[9px] text-slate-300 flex items-center justify-center">{i + 1}</span>{a}</div></div>
            ))}
            <div className="mt-3 flex gap-2"><span className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-[11px] font-semibold">Turn on</span><span className="px-3 py-1.5 rounded-lg border border-white/15 text-slate-300 text-[11px]">Edit steps</span></div>
          </div>
          <div className="space-y-3">
            <div className={PANEL}>
              <Title right={<Chip tone="emerald">On</Chip>}>Closing reminder</Title>
              <p className="text-[11px] text-slate-300">Trigger: 7 days before closing</p><p className="text-[11px] text-slate-300">Send your reminder template to the agent</p>
            </div>
            <div className={PANEL}><Title>Recent runs</Title><p className="text-[11px] text-slate-300">412 Larkspur Lane · reminder sent</p><p className="text-[11px] text-slate-300">88 Harbor View Dr · checklist created</p></div>
          </div>
        </div>
      </div>
    </Chrome>
  );
}

/** Before and after: scattered tools against one workspace. */
export function ProblemContrastMockup() {
  const scraps: [string, string][] = [['Deals spreadsheet', 'Sheet1 · last edited 3 weeks ago'], ['Calendar', 'Closing Dec 12?'], ['Inbox', '37 unread · “Re: Re: inspection”'], ['Shared folder', 'Contract_final_v3.pdf'], ['Contacts', 'Lender? Title? Check old email'], ['Listing tracker', 'Separate from the deal']];
  return (
    <div className="grid md:grid-cols-[1fr_auto_1fr] gap-5 items-center">
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Today</p>
        <div className="grid grid-cols-2 gap-2.5">
          {scraps.map(([t, s], i) => (
            <div key={t} className={`rounded-lg border border-dashed border-slate-600 bg-slate-800/40 p-3 ${i % 2 ? 'translate-y-2' : ''}`}>
              <p className="text-[11px] font-semibold text-slate-300">{t}</p><p className="text-[10px] text-slate-500 mt-0.5">{s}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="hidden md:flex flex-col items-center text-blue-300"><span className="text-[10px] uppercase tracking-wider mb-1">With Relay</span><svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-5-5l5 5-5 5" /></svg></div>
      <div>
        <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider mb-3">One workspace</p>
        <Chrome label="Relay">
          <div className="p-3 space-y-2">
            <Deal addr="412 Larkspur Lane" stage="Under contract" tone="blue" pct={67} close="Dec 12" />
            <div className="grid grid-cols-3 gap-2 text-center">{['Dates', 'Documents', 'Contacts'].map((x) => <div key={x} className={`${PANEL} py-2`}><p className="text-[11px] text-slate-200">{x}</p></div>)}</div>
            <div className="grid grid-cols-2 gap-2 text-center">{['Messages', 'Listings'].map((x) => <div key={x} className={`${PANEL} py-2`}><p className="text-[11px] text-slate-200">{x}</p></div>)}</div>
          </div>
        </Chrome>
      </div>
    </div>
  );
}

/** How the pieces connect: one transaction at the centre, fragments around it, lines showing what feeds what. */
export function ConnectedMockup() {
  const cells: { pos: string; title: string; body: string }[] = [
    { pos: 'col-start-1 row-start-1', title: 'Contract', body: 'Fills in the address, price, parties and dates' },
    { pos: 'col-start-2 row-start-1', title: 'Contacts', body: 'Lender, title and inspector on the deal' },
    { pos: 'col-start-3 row-start-1', title: 'Listing', body: 'Accepted offer becomes the transaction' },
    { pos: 'col-start-1 row-start-2', title: 'Tasks and documents', body: 'Checklist steps with files attached' },
    { pos: 'col-start-3 row-start-2', title: 'Calendar', body: 'Key dates stay on your calendar' },
    { pos: 'col-start-1 row-start-3', title: 'Automations', body: 'React when a date or stage changes' },
    { pos: 'col-start-2 row-start-3', title: 'Messages', body: 'Email and updates, logged on the deal' },
    { pos: 'col-start-3 row-start-3', title: 'Templates', body: 'Shared wording, used everywhere' },
  ];
  const ends: [number, number][] = [[16.7, 16.7], [50, 16.7], [83.3, 16.7], [16.7, 50], [83.3, 50], [16.7, 83.3], [50, 83.3], [83.3, 83.3]];
  return (
    <div className="relative">
      <svg className="absolute inset-0 w-full h-full pointer-events-none hidden md:block" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {ends.map(([x, y]) => <line key={`${x}-${y}`} x1="50" y1="50" x2={x} y2={y} className="stroke-blue-400/30" strokeWidth="0.4" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="relative grid md:grid-cols-3 md:grid-rows-3 gap-4 md:gap-8">
        {cells.map((c) => (
          <div key={c.title} className={`${c.pos} rounded-xl border border-white/10 bg-slate-900 p-3.5 shadow-lg shadow-black/30`}>
            <p className="text-xs font-semibold text-slate-100">{c.title}</p><p className="text-[11px] text-slate-400 mt-0.5">{c.body}</p>
          </div>
        ))}
        <div className="md:col-start-2 md:row-start-2 rounded-xl border border-blue-400/50 bg-blue-500/10 p-4 text-center shadow-xl shadow-blue-900/30">
          <p className="text-[9px] uppercase tracking-wider text-blue-300">Transaction</p>
          <p className="text-sm font-semibold text-slate-100">412 Larkspur Lane</p>
          <div className="mt-2"><Bar pct={67} /></div>
        </div>
      </div>
    </div>
  );
}

/** Compact versions for the three audience cards. They are deliberately different from one another. */
export function AgentMini() {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2"><Stat label="My deals" value="5" /><Stat label="My listings" value="2" tone="text-emerald-300" /></div>
      <Deal addr="31 Willow Bend" stage="Under contract" tone="blue" pct={58} close="Dec 15" />
    </div>
  );
}
export function CoordinatorMini() {
  return (
    <div className={`${PANEL} p-0 overflow-hidden`}>
      {[['412 Larkspur', 'M. Rivera', 'Today', 'red'], ['88 Harbor View', 'J. Okafor', 'Dec 4', 'amber'], ['1209 Elm Ct', 'M. Rivera', 'Dec 2', 'emerald']].map(([a, g, d, t]) => (
        <div key={a} className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/5 last:border-0 text-[11px]"><span className="text-slate-100">{a}</span><span className="text-slate-500">{g}</span><Chip tone={t as Tone}>{d}</Chip></div>
      ))}
    </div>
  );
}
export function BrokerageMini() {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2"><Stat label="Agents" value="38" /><Stat label="Open deals" value="142" /><Stat label="Attention" value="6" tone="text-amber-300" /></div>
      <div className={PANEL}><div className="flex justify-between"><p className="text-[11px] text-slate-200">New transaction onboarding</p><Chip tone="emerald">Published</Chip></div></div>
    </div>
  );
}

function IntakeField({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-white/5 last:border-0 text-[11px]"><span className="text-slate-500">{k}</span><span className="text-slate-100 text-right">{v}</span></div>
  );
}

/** AI contract intake: a purchase contract or listing agreement goes in, a filled-in workspace comes out. */
export function ContractIntakeMockup() {
  return (
    <div className="grid lg:grid-cols-[2fr_auto_5fr] gap-5 items-center">
      <div className="space-y-3">
        {[['Purchase contract', 'Executed purchase agreement', 'PDF'], ['Listing agreement', 'Exclusive right to sell', 'PDF']].map(([t, s, f], i) => (
          <div key={t} className={`rounded-xl border ${i === 0 ? 'border-blue-400/50 bg-blue-500/10' : 'border-white/10 bg-white/[0.04]'} p-4`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-12 rounded-md bg-white/90 flex flex-col gap-1 p-1.5 shrink-0" aria-hidden>
                <span className="h-1 rounded bg-slate-400" /><span className="h-1 rounded bg-slate-300" /><span className="h-1 w-2/3 rounded bg-slate-300" /><span className="h-1 rounded bg-blue-400/70" /><span className="h-1 w-1/2 rounded bg-slate-300" />
              </div>
              <div className="min-w-0"><p className="text-xs font-semibold text-slate-100">{t}</p><p className="text-[10px] text-slate-400">{s}</p></div>
              <Chip tone="slate">{f}</Chip>
            </div>
          </div>
        ))}
        <p className="text-[11px] text-slate-400 text-center">Upload either one. No retyping.</p>
      </div>
      <div className="flex lg:flex-col items-center justify-center gap-2 text-blue-300">
        <span className="text-[10px] uppercase tracking-wider">Relay reads it</span>
        <svg className="w-8 h-8 rotate-90 lg:rotate-0" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-5-5l5 5-5 5" /></svg>
      </div>
      <Chrome label="412 Larkspur Lane · New transaction">
        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-100">Filled in from the contract</p><Chip tone="amber">You review, then save</Chip></div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className={PANEL}>
              <Title>Property and price</Title>
              <IntakeField k="Address" v="412 Larkspur Lane" /><IntakeField k="Purchase price" v="$415,000" /><IntakeField k="Earnest money" v="$5,000" /><IntakeField k="Financing" v="Conventional" />
            </div>
            <div className={PANEL}>
              <Title>Key dates</Title>
              <IntakeField k="Accepted" v="Nov 14" /><IntakeField k="Earnest money due" v="Nov 17" /><IntakeField k="Inspection deadline" v="Nov 24" /><IntakeField k="Appraisal" v="Dec 2" /><IntakeField k="Closing" v="Dec 12" />
            </div>
          </div>
          <div className={PANEL}>
            <Title right={<Chip tone="emerald">Added to the deal</Chip>}>Contacts pulled from the contract</Title>
            <div className="grid sm:grid-cols-2 gap-x-6">
              <IntakeField k="Buyer" v="Dana and Chris Whitfield" /><IntakeField k="Seller" v="Priya Raman" /><IntakeField k="Lender" v="Harbor Federal" /><IntakeField k="Title and escrow" v="Cedar Title · escrow officer, email, phone" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className={PANEL}><Title>Created for you</Title><p className="text-[11px] text-slate-300">Closing checklist with dated steps</p><p className="text-[11px] text-slate-300">Critical dates on your calendar</p><p className="text-[11px] text-slate-300">The contract, filed on the deal</p></div>
            <div className={PANEL}><Title>For a listing</Title><p className="text-[11px] text-slate-300">List price, MLS number, listing period</p><p className="text-[11px] text-slate-300">Sellers and agents with roles and contact details</p><p className="text-[11px] text-slate-300">Fee terms, and anything to double-check</p></div>
          </div>
        </div>
      </Chrome>
    </div>
  );
}
