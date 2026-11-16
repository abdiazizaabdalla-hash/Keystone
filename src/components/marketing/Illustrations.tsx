// Original line illustrations for the public site (inline SVG, no images to load). They use only the site's slate/blue palette.
// Each one has a plain-language label for screen readers. Nothing here depicts a real person, brand or product screen.

const frame = 'w-full h-auto rounded-2xl border border-slate-700 bg-slate-800/50';
const box = 'fill-slate-800 stroke-slate-600';
const hot = 'fill-blue-500/15 stroke-blue-400';
const t1 = 'fill-slate-100 text-[13px] font-semibold';
const t2 = 'fill-slate-400 text-[11px]';
const line = 'stroke-slate-500';

/** A deal moving left to right: contract in, checklist and dates, closing out. */
export function DealFlowIllustration() {
  const steps = [
    { x: 24, title: 'Contract', sub: 'Upload it, Relay fills in the deal' },
    { x: 218, title: 'Checklist', sub: 'Steps, due dates, templates' },
    { x: 412, title: 'Key dates', sub: 'Reminders before each deadline' },
    { x: 606, title: 'Closing', sub: 'Invoice, archive, done' },
  ];
  return (
    <svg viewBox="0 0 800 170" className={frame} role="img" aria-label="A deal moves from contract to checklist to key dates to closing">
      {steps.map((s, i) => (
        <g key={s.title}>
          <rect x={s.x} y="36" width="170" height="92" rx="14" className={i === 1 ? hot : box} strokeWidth="1.5" />
          <circle cx={s.x + 24} cy="62" r="11" className="fill-blue-500" />
          <text x={s.x + 24} y="66" textAnchor="middle" className="fill-white text-[12px] font-semibold">{i + 1}</text>
          <text x={s.x + 44} y="67" className={t1}>{s.title}</text>
          <text x={s.x + 16} y="98" className={t2}>{s.sub.length > 26 ? s.sub.slice(0, s.sub.lastIndexOf(' ', 26)) : s.sub}</text>
          <text x={s.x + 16} y="113" className={t2}>{s.sub.length > 26 ? s.sub.slice(s.sub.lastIndexOf(' ', 26) + 1) : ''}</text>
          {i < steps.length - 1 && <path d={`M${s.x + 174} 82 h16`} className={line} strokeWidth="2" markerEnd="url(#arrow)" />}
        </g>
      ))}
      <defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" className="fill-slate-500" /></marker>
      </defs>
    </svg>
  );
}

/** Coordinator, agent and client side by side: who sees what. */
export function PortalIllustration() {
  const boxes = [
    { x: 30, hot: false, h: 'Agent', l: ['Free login', 'Only the deals and listings', 'the coordinator picks'], badge: true },
    { x: 290, hot: true, h: 'Coordinator', l: ['Runs the deals in Relay', 'Chooses what each', 'agent can see'], badge: false },
    { x: 550, hot: false, h: 'Client', l: ['A live progress page', 'the agent chooses', 'to share'], badge: false },
  ];
  return (
    <svg viewBox="0 0 800 290" className={frame} role="img" aria-label="A coordinator gives an agent a free login to chosen deals, and the agent shares a progress page with their client">
      {boxes.map((b) => (
        <g key={b.h}>
          <rect x={b.x} y="30" width="220" height="140" rx="16" className={b.hot ? hot : box} strokeWidth="1.5" />
          <text x={b.x + 110} y="62" textAnchor="middle" className={t1}>{b.h}</text>
          {b.l.map((line, i) => <text key={line} x={b.x + 110} y={86 + i * 17} textAnchor="middle" className={t2}>{line}</text>)}
          {b.badge && (<><rect x={b.x + 52} y="136" width="116" height="20" rx="10" className="fill-emerald-500/15 stroke-emerald-400" /><text x={b.x + 110} y="150" textAnchor="middle" className="fill-emerald-300 text-[10px] font-semibold">FREE FOR THE AGENT</text></>)}
        </g>
      ))}
      <path d="M246 100 H274" className="stroke-blue-400" strokeWidth="3" strokeLinecap="round" />
      <path d="M506 100 H534" className="stroke-blue-400" strokeWidth="3" strokeLinecap="round" />
      <rect x="60" y="198" width="680" height="68" rx="14" className="fill-slate-900/70 stroke-slate-700" />
      <text x="400" y="226" textAnchor="middle" className={t1}>Access is a choice, deal by deal</text>
      <text x="400" y="248" textAnchor="middle" className={t2}>Tick the deals and listings an agent can see. Untick to take one away. Nothing else is shared.</text>
    </svg>
  );
}

/** Three coordinators on a team: shared board and contacts on top, each person's own deals underneath and private. */
export function TeamIllustration() {
  const seats = [40, 290, 540];
  return (
    <svg viewBox="0 0 800 300" className={frame} role="img" aria-label="A team of three coordinators shares a message board and contacts, while each person keeps their own deals private">
      <rect x="40" y="24" width="720" height="70" rx="14" className={hot} strokeWidth="1.5" />
      <text x="400" y="54" textAnchor="middle" className={t1}>Shared by the team</text>
      <text x="400" y="76" textAnchor="middle" className={t2}>Message board, direct messages, lenders, title companies and inspectors</text>
      {seats.map((x, i) => (
        <g key={x}>
          <path d={`M${x + 110} 94 V130`} className={line} strokeWidth="1.5" strokeDasharray="4 4" />
          <rect x={x} y="130" width="220" height="104" rx="14" className={box} strokeWidth="1.5" />
          <circle cx={x + 26} cy="158" r="12" className="fill-blue-500" />
          <text x={x + 26} y="162" textAnchor="middle" className="fill-white text-[11px] font-semibold">{['A', 'B', 'C'][i]}</text>
          <text x={x + 48} y="162" className={t1}>Coordinator {['A', 'B', 'C'][i]}</text>
          <text x={x + 18} y="192" className={t2}>Own deals, agents, notes</text>
          <rect x={x + 18} y="204" width="76" height="18" rx="9" className="fill-slate-900 stroke-slate-600" />
          <text x={x + 56} y="217" textAnchor="middle" className="fill-slate-300 text-[10px] font-semibold">PRIVATE</text>
        </g>
      ))}
      <text x="400" y="272" textAnchor="middle" className={t2}>Owner status report: every open file, progress and overdue dates, with no client details</text>
    </svg>
  );
}

/** Two ways an agent gets their own workspace. */
export function AgentPathsIllustration() {
  return (
    <svg viewBox="0 0 800 260" className={frame} role="img" aria-label="Agents choose Starter or Pro. Pro adds your own templates and automations">
      <rect x="30" y="30" width="350" height="190" rx="16" className={box} strokeWidth="1.5" />
      <text x="205" y="64" textAnchor="middle" className={t1}>Starter</text>
      <text x="205" y="88" textAnchor="middle" className={t2}>Run your own deals and listings</text>
      <text x="205" y="108" textAnchor="middle" className={t2}>Read a contract and fill in the deal</text>
      <text x="205" y="128" textAnchor="middle" className={t2}>Follow-ups, contacts and invoices</text>
      <rect x="95" y="160" width="220" height="30" rx="15" className="fill-slate-700/60 stroke-slate-500" />
      <text x="205" y="180" textAnchor="middle" className="fill-slate-200 text-[12px] font-semibold">$19 a month</text>
      <rect x="420" y="30" width="350" height="190" rx="16" className={hot} strokeWidth="1.5" />
      <text x="595" y="64" textAnchor="middle" className={t1}>Pro</text>
      <text x="595" y="88" textAnchor="middle" className={t2}>Everything in Starter, plus</text>
      <text x="595" y="108" textAnchor="middle" className={t2}>custom checklist templates</text>
      <text x="595" y="128" textAnchor="middle" className={t2}>and automations that run for you</text>
      <rect x="485" y="160" width="220" height="30" rx="15" className="fill-blue-500/20 stroke-blue-400" />
      <text x="595" y="180" textAnchor="middle" className="fill-blue-200 text-[12px] font-semibold">$39 a month</text>
    </svg>
  );
}

/** A brokerage owner's view across a roster of agents. */
export function BrokerageDashboardIllustration() {
  const rows = [
    { n: 'Agent 1', open: 6, late: 0, w: 120 },
    { n: 'Agent 2', open: 4, late: 1, w: 80 },
    { n: 'Agent 3', open: 9, late: 2, w: 170 },
    { n: 'Agent 4', open: 3, late: 0, w: 60 },
  ];
  return (
    <svg viewBox="0 0 800 330" className={frame} role="img" aria-label="A brokerage dashboard showing each agent's open deals, late items and closings this week, with a missing-documents flag">
      <rect x="30" y="24" width="740" height="282" rx="16" className="fill-slate-900/70 stroke-slate-700" />
      <text x="54" y="56" className={t1}>Brokerage dashboard</text>
      {[['Agents', '18'], ['Open deals', '46'], ['Closing this week', '5'], ['Missing documents', '7']].map(([k, v], i) => (
        <g key={k}>
          <rect x={54 + i * 178} y="70" width="164" height="58" rx="10" className={i === 3 ? 'fill-amber-500/10 stroke-amber-400' : box} strokeWidth="1.2" />
          <text x={68 + i * 178} y="94" className={t2}>{k}</text>
          <text x={68 + i * 178} y="118" className="fill-slate-100 text-[20px] font-semibold">{v}</text>
        </g>
      ))}
      {rows.map((r, i) => (
        <g key={r.n}>
          <text x="58" y={166 + i * 34} className="fill-slate-300 text-[12px]">{r.n}</text>
          <rect x="150" y={154 + i * 34} width="300" height="12" rx="6" className="fill-slate-800" />
          <rect x="150" y={154 + i * 34} width={r.w} height="12" rx="6" className="fill-blue-500/70" />
          <text x="470" y={165 + i * 34} className={t2}>{r.open} open</text>
          <text x="560" y={165 + i * 34} className={r.late ? 'fill-amber-300 text-[11px]' : t2}>{r.late ? `${r.late} late` : 'on track'}</text>
          {r.late > 0 && <rect x="650" y={152 + i * 34} width="92" height="18" rx="9" className="fill-amber-500/10 stroke-amber-400" />}
          {r.late > 0 && <text x="696" y={165 + i * 34} textAnchor="middle" className="fill-amber-200 text-[10px] font-semibold">REVIEW</text>}
        </g>
      ))}
    </svg>
  );
}

/** Who pays for what, in one picture: three audiences, three plain labels. */
export function WhoPaysIllustration() {
  const cols = [
    { x: 30, h: 'Coordinators', s: 'Choose a plan', p: 'From $19 a month', hot: false },
    { x: 290, h: 'Agents', s: 'Starter or Pro', s2: '', p: '$19 or $39 a month', hot: true },
    { x: 550, h: 'Brokerages', s: 'One plan covers your agents', p: 'From $99 a month', hot: false },
  ];
  return (
    <svg viewBox="0 0 800 190" className={frame} role="img" aria-label="Coordinators pay from 19 dollars a month, agents choose Starter at 19 dollars or Pro at 39 dollars a month, brokerages pay from 99 dollars a month">
      {cols.map((c) => (
        <g key={c.h}>
          <rect x={c.x} y="24" width="220" height="142" rx="16" className={c.hot ? hot : box} strokeWidth="1.5" />
          <text x={c.x + 110} y="58" textAnchor="middle" className={t1}>{c.h}</text>
          <text x={c.x + 110} y="84" textAnchor="middle" className={t2}>{c.s}</text>
          <text x={c.x + 110} y="100" textAnchor="middle" className={t2}>{c.s2 ?? ''}</text>
          <text x={c.x + 110} y="138" textAnchor="middle" className="fill-blue-300 text-[15px] font-semibold">{c.p}</text>
        </g>
      ))}
    </svg>
  );
}

/** File review: the documents every file must have, what is missing, and the owner's own review record. */
export function FileReviewIllustration() {
  const docs = [
    { n: 'Executed contract', ok: true },
    { n: 'Agency disclosure (IABS)', ok: true },
    { n: 'Earnest money receipt', ok: true },
    { n: 'Inspection report', ok: false },
    { n: 'Final closing statement', ok: false },
  ];
  return (
    <svg viewBox="0 0 800 330" className={frame} role="img" aria-label="A closed file checked against the brokerage's required documents, with two missing items flagged for the agent and a reviewed or flagged record kept by the broker">
      <rect x="30" y="24" width="470" height="282" rx="16" className="fill-slate-900/70 stroke-slate-700" />
      <text x="54" y="54" className={t1}>Closed file: required documents</text>
      {docs.map((d, i) => (
        <g key={d.n}>
          <rect x="54" y={72 + i * 44} width="422" height="34" rx="10" className={d.ok ? box : 'fill-amber-500/10 stroke-amber-400'} strokeWidth="1.2" />
          <circle cx="78" cy={89 + i * 44} r="9" className={d.ok ? 'fill-emerald-500/20 stroke-emerald-400' : 'fill-amber-500/20 stroke-amber-400'} />
          <text x="78" y={93 + i * 44} textAnchor="middle" className={d.ok ? 'fill-emerald-300 text-[11px] font-semibold' : 'fill-amber-200 text-[11px] font-semibold'}>{d.ok ? '✓' : '!'}</text>
          <text x="98" y={94 + i * 44} className="fill-slate-200 text-[12px]">{d.n}</text>
          <text x="458" y={94 + i * 44} textAnchor="end" className={d.ok ? t2 : 'fill-amber-200 text-[11px] font-semibold'}>{d.ok ? 'on file' : 'MISSING'}</text>
        </g>
      ))}
      <rect x="530" y="24" width="240" height="282" rx="16" className={hot} strokeWidth="1.5" />
      <text x="650" y="54" textAnchor="middle" className={t1}>Your review</text>
      <text x="650" y="78" textAnchor="middle" className={t2}>Your own record.</text>
      <text x="650" y="94" textAnchor="middle" className={t2}>The agent’s deal never changes.</text>
      <rect x="560" y="120" width="180" height="40" rx="12" className="fill-emerald-500/15 stroke-emerald-400" />
      <text x="650" y="145" textAnchor="middle" className="fill-emerald-200 text-[12px] font-semibold">Mark reviewed</text>
      <rect x="560" y="174" width="180" height="40" rx="12" className="fill-amber-500/15 stroke-amber-400" />
      <text x="650" y="199" textAnchor="middle" className="fill-amber-200 text-[12px] font-semibold">Flag for the agent</text>
      <text x="650" y="248" textAnchor="middle" className={t2}>Choose the documents</text>
      <text x="650" y="264" textAnchor="middle" className={t2}>every file must contain.</text>
    </svg>
  );
}

/** The broker at the center: roster, shared templates, board, private messages, commissions. */
export function BrokerageHubIllustration() {
  const spokes = [
    { x: 40, y: 30, h: 'Agent roster', s: 'Invite, see activity' },
    { x: 560, y: 30, h: 'Shared templates', s: 'Your IABS, pinned for all' },
    { x: 40, y: 200, h: 'Team board', s: 'Announcements, questions' },
    { x: 560, y: 200, h: 'Commissions', s: 'Statements and a ledger' },
  ];
  return (
    <svg viewBox="0 0 800 330" className={frame} role="img" aria-label="A broker at the center connected to the agent roster, shared templates, the team board and private messages, and commission statements">
      {spokes.map((p) => (
        <g key={p.h}>
          <path d={`M${p.x < 400 ? p.x + 200 : p.x} ${p.y + 50} L${p.x < 400 ? 300 : 500} ${p.y < 100 ? 140 : 190}`} className={line} strokeWidth="1.5" strokeDasharray="5 4" />
          <rect x={p.x} y={p.y} width="200" height="100" rx="14" className={box} strokeWidth="1.5" />
          <text x={p.x + 100} y={p.y + 42} textAnchor="middle" className={t1}>{p.h}</text>
          <text x={p.x + 100} y={p.y + 64} textAnchor="middle" className={t2}>{p.s}</text>
        </g>
      ))}
      <rect x="300" y="115" width="200" height="100" rx="16" className={hot} strokeWidth="1.5" />
      <text x="400" y="158" textAnchor="middle" className={t1}>You, the broker</text>
      <text x="400" y="180" textAnchor="middle" className={t2}>One view of the brokerage</text>
      <text x="400" y="198" textAnchor="middle" className={t2}>+ private messages</text>
    </svg>
  );
}

/** A simple three-step flow: something happens, a template is chosen, the message goes out. */
export function AutomationFlowIllustration() {
  const steps = [
    { x: 40, title: 'Something happens', sub: 'A new deal, or a date gets close' },
    { x: 300, title: 'Your template is picked', sub: 'The email you wrote once' },
    { x: 560, title: 'Relay sends it', sub: 'To the people on the deal' },
  ];
  return (
    <svg viewBox="0 0 800 150" className={frame} role="img" aria-label="An automation: something happens on a deal, your template is picked, and Relay sends the email for you">
      <defs>
        <marker id="arrow2" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" className="fill-slate-500" /></marker>
      </defs>
      {steps.map((s, i) => (
        <g key={s.title}>
          <rect x={s.x} y="30" width="200" height="90" rx="14" className={i === 1 ? hot : box} strokeWidth="1.5" />
          <text x={s.x + 18} y="64" className={t1}>{s.title}</text>
          <text x={s.x + 18} y="88" className={t2}>{s.sub}</text>
          {i < steps.length - 1 && <path d={`M${s.x + 206} 75 h48`} className={line} strokeWidth="2" markerEnd="url(#arrow2)" />}
        </g>
      ))}
    </svg>
  );
}

/** Invoice to paid to accounting: how money moves for a TC. */
export function PayFlowIllustration() {
  const steps = [
    { x: 40, title: 'Invoice the agent', sub: 'From the deal, with your logo' },
    { x: 300, title: 'Get paid', sub: 'Stripe, Zelle or check' },
    { x: 560, title: 'Export', sub: 'QuickBooks files and reports' },
  ];
  return (
    <svg viewBox="0 0 800 150" className={frame} role="img" aria-label="Invoices go from the deal to the agent, get paid, and export to QuickBooks">
      <defs>
        <marker id="arrow3" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" className="fill-slate-500" /></marker>
      </defs>
      {steps.map((s, i) => (
        <g key={s.title}>
          <rect x={s.x} y="30" width="200" height="90" rx="14" className={i === 1 ? hot : box} strokeWidth="1.5" />
          <text x={s.x + 18} y="64" className={t1}>{s.title}</text>
          <text x={s.x + 18} y="88" className={t2}>{s.sub}</text>
          {i < steps.length - 1 && <path d={`M${s.x + 206} 75 h48`} className={line} strokeWidth="2" markerEnd="url(#arrow3)" />}
        </g>
      ))}
    </svg>
  );
}

/** A brokerage shares a template once; every agent sees it pinned. */
export function TemplateSharingIllustration() {
  return (
    <svg viewBox="0 0 700 190" className={frame} role="img" aria-label="A brokerage shares a template once and it appears pinned for every agent">
      <defs>
        <marker id="arrow4" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" className="fill-blue-400" /></marker>
      </defs>
      <rect x="30" y="30" width="270" height="130" rx="14" className={box} strokeWidth="1.5" />
      <text x="50" y="62" className={t1}>Brokerage</text>
      <rect x="50" y="78" width="230" height="30" rx="8" className="fill-slate-700 stroke-slate-600" />
      <text x="64" y="98" className="fill-slate-200 text-[13px]">Welcome letter</text>
      <text x="50" y="140" className={t2}>Share it once</text>
      <path d="M312 95 h76" className="stroke-blue-400" strokeWidth="2" markerEnd="url(#arrow4)" />
      <rect x="400" y="30" width="270" height="130" rx="14" className={hot} strokeWidth="1.5" />
      <text x="420" y="62" className={t1}>Every agent</text>
      <rect x="420" y="78" width="230" height="30" rx="8" className="fill-slate-700 stroke-slate-600" />
      <text x="434" y="98" className="fill-slate-200 text-[13px]">Welcome letter (pinned)</text>
      <text x="420" y="140" className={t2}>It is already in their list</text>
    </svg>
  );
}

/** Home hero: one deal in the middle, everyone who works on it around it. Same weight for each role. */
export function HeroIllustration() {
  const roles = [
    { x: 30, y: 30, h: 'Agents', s: 'Their deals and listings' },
    { x: 410, y: 30, h: 'Coordinators', s: 'Checklists, dates, documents' },
    { x: 30, y: 300, h: 'Teams', s: 'Shared desk, private files' },
    { x: 410, y: 300, h: 'Brokerages', s: 'Compliance and commissions' },
  ];
  return (
    <svg viewBox="0 0 640 450" className={frame} role="img" aria-label="Agents, coordinators, coordinator teams and brokerages all work on the same deal in Relay">
      {roles.map((r) => (
        <g key={r.h}>
          <path d={`M${r.x + 100} ${r.y + 60 + (r.y > 100 ? -0 : 0)} L320 225`} className={line} strokeWidth="1.5" strokeDasharray="4 5" />
          <rect x={r.x} y={r.y} width="200" height="100" rx="16" className={box} strokeWidth="1.5" />
          <circle cx={r.x + 28} cy={r.y + 34} r="13" className="fill-blue-500/20 stroke-blue-400" />
          <circle cx={r.x + 28} cy={r.y + 31} r="4" className="fill-blue-300" />
          <path d={`M${r.x + 20} ${r.y + 42} a8 6 0 0 1 16 0`} className="fill-blue-300" />
          <text x={r.x + 52} y={r.y + 39} className={t1}>{r.h}</text>
          <text x={r.x + 18} y={r.y + 72} className={t2}>{r.s}</text>
        </g>
      ))}
      <rect x="200" y="160" width="240" height="130" rx="18" className={hot} strokeWidth="2" />
      <text x="320" y="192" textAnchor="middle" className="fill-slate-100 text-[15px] font-semibold">123 Main Street</text>
      <text x="320" y="210" textAnchor="middle" className={t2}>Under contract · closes Dec 12</text>
      <rect x="226" y="226" width="188" height="8" rx="4" className="fill-slate-700" />
      <rect x="226" y="226" width="126" height="8" rx="4" className="fill-blue-500" />
      <text x="226" y="256" className={t2}>Checklist</text>
      <text x="414" y="256" textAnchor="end" className="fill-blue-300 text-[11px] font-semibold">67%</text>
      <text x="320" y="278" textAnchor="middle" className={t2}>Dates · Documents · Messages · Invoice</text>
    </svg>
  );
}
