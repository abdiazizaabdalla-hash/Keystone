import { BROKERAGE_PRICING, dollars } from './brokeragePricing';

// Prices and plain-language feature lists for the agent and brokerage sections of the public site. Copy only: nothing here bills anyone.
// The Starter, Pro and Team plans (which agents share with coordinators) come from plans.ts. Billing for the brokerage tiers is not built yet, so the
// site offers a pilot for those (see docs/PRICING_ENTITLEMENT_DESIGN.md); the numbers below are the ones the pilot converts to.

export const BROKERAGE_TIERS = {
  basic: {
    name: 'Brokerage Basic',
    price: dollars(BROKERAGE_PRICING.basic.base),
    period: '/month',
    agents: BROKERAGE_PRICING.basic.includedAgents,
    blurb: 'Run your brokerage from one place. Centralize transaction oversight, monitor compliance and keep your agents organized.',
    built: [
      'Full Agent Basic workspace for every agent',
      'Invite and manage your agents',
      'Dashboard: open deals, late items, closings this week, last activity',
      'Read-only view of every agent’s deals, deadlines and listings',
      'Compliance desk: files to review, missing-document flags, and a review record you keep',
      'One universal required-document list for every file',
      'Default required steps for every listing and transaction, added to new files automatically',
      'Six built-in office automations: stalled files, closing deadlines, missing documents, new-agent welcome, a daily digest and a monthly report',
      'Team board and private messages',
      'Commission statements: confirm, accept, mark paid',
      'Pay agents their commissions through Relay with your connected Stripe account',
      'Agent-by-month production export',
      'One extra managing account or administrator',
    ],
  },
  pro: {
    name: 'Brokerage Pro',
    price: dollars(BROKERAGE_PRICING.pro.base),
    period: '/month',
    agents: BROKERAGE_PRICING.pro.includedAgents,
    blurb: 'Take control of brokerage operations. Configurable compliance, deeper reporting, custom workflows and Agent Pro workspaces.',
    built: [
      'Everything in Basic',
      'Full Agent Pro workspace for every agent, with automations and custom templates',
      'Up to 10 required-document lists, matched to deal types such as Cash or Condo',
      'Reports tab: trends and comparisons across agents and time, and configurable deal-level reports',
      'Custom workflow builder with a template library, run history and active-workflow stats',
      'Scoped roles for administrators, up to five extra',
    ],
  },
  extraAgent: { basic: dollars(BROKERAGE_PRICING.basic.extraAgent), pro: dollars(BROKERAGE_PRICING.pro.extraAgent) },
} as const;

export const PILOT = '30 days of Brokerage Pro, free, with no card needed. If it is not for you, nothing renews and your agents keep read access to what they already have.';
