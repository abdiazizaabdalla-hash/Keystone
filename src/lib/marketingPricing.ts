// Prices and plain-language feature lists for the agent and brokerage sections of the public site. Copy only: nothing here bills anyone.
// The coordinator plans (Starter, Pro, Team) come from plans.ts. Billing for Agent Pro and the brokerage tiers is not built yet, so the
// site offers a pilot for those (see docs/PRICING_ENTITLEMENT_DESIGN.md); the numbers below are the ones the pilot converts to.

export const AGENT_PRO = {
  price: '$19',
  period: '/month',
  includedByBrokerage: [
    'Run your own deals and listings in one place',
    'AI reads a contract and fills out and creates the transaction or listing for you',
    'Follow-ups, contacts and invoices',
    'Use your brokerage’s templates and Relay’s standard forms',
    'Your brokerage can see where your deals stand',
  ],
  proAdds: [
    'Save your own templates, emails and checklists',
    'Automations that send reminders and follow-ups for you',
    'Keep it if you ever change brokerages',
  ],
} as const;

export const BROKERAGE_TIERS = {
  basic: {
    name: 'Brokerage Basic',
    price: '$99',
    period: '/month',
    agents: 10,
    blurb: 'See your whole roster and every file, with required documents checked.',
    built: [
      'Invite and manage your agents',
      'Dashboard: open deals, late items, closings this week, last activity',
      'Read-only view of every agent’s deals, deadlines and listings',
      'Required-document review with missing-document flags',
      'Team board and private messages',
      'Commission statements: confirm, accept, mark paid',
      'Agent-by-month production export',
      'One extra administrator',
    ],
  },
  pro: {
    name: 'Brokerage Pro',
    price: '$199',
    period: '/month',
    agents: 25,
    blurb: 'More agents and finer control over documents, reports and who can do what.',
    built: ['Everything in Basic', 'Up to 25 agents included'],
    rollingOut: [
      'Several required-document lists, by deal type',
      'Configurable, deal-level reports',
      'Trends and comparisons across agents and time',
      'Scoped roles for administrators (up to five extra)',
      'Pay commissions through Relay with your connected Stripe account',
    ],
  },
  extraAgent: '$6',
} as const;

export const PILOT = '30 days of Brokerage Pro, free, with no card needed. If it is not for you, nothing renews and your agents keep read access to what they already have.';
