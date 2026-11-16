// Prices and plain-language feature lists for the agent and brokerage sections of the public site. Copy only: nothing here bills anyone.
// The Starter, Pro and Team plans (which agents share with coordinators) come from plans.ts. Billing for the brokerage tiers is not built yet, so the
// site offers a pilot for those (see docs/PRICING_ENTITLEMENT_DESIGN.md); the numbers below are the ones the pilot converts to.

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
      'Compliance desk: files to review, missing-document flags, and a review record you keep',
      'Default required steps for every listing and transaction, added to new files automatically',
      'Automations that watch the whole office: stalled files, closing deadlines, missing documents, new-agent welcome and a daily digest',
      'Team board and private messages',
      'Commission statements: confirm, accept, mark paid',
      'Pay agents their commissions through Relay with your connected Stripe account',
      'Agent-by-month production export',
      'Reports tab: trends and comparisons across agents and time, configurable deal-level reports, and scheduled team activity workbooks',
      'Custom workflow builder with a template library, run history and active-workflow stats',
      'One extra managing account or administrator',
    ],
  },
  pro: {
    name: 'Brokerage Pro',
    price: '$199',
    period: '/month',
    agents: 25,
    blurb: 'More agents and finer control over documents, reports and who can do what.',
    built: [
      'Everything in Basic',
      'Up to 25 agents included',
      'Several required-document lists, by deal type',
      'Scoped roles for administrators (up to five extra)',
    ],
  },
  extraAgent: '$6',
} as const;

export const PILOT = '30 days of Brokerage Pro, free, with no card needed. If it is not for you, nothing renews and your agents keep read access to what they already have.';
