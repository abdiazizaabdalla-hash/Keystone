# Stripe prices and environment variables

Every price Relay bills has its own environment variable (see `src/lib/stripePrices.ts`). To change a price later:

1. Stripe dashboard -> Product catalog -> the product -> **Add another price** (prices cannot be edited).
2. Copy the new `price_...` id into the matching variable in Vercel and redeploy.
3. Update the amount shown on the website (`src/lib/plans.ts` for personal plans, `src/lib/brokeragePricing.ts` for brokerage tiers).
4. Existing subscribers keep the price they signed up on. Archive the old price in Stripe when nobody should pick it any more.

## Variables

| Variable | Price | Amount today |
|---|---|---|
| `STRIPE_PRICE_AGENT_STARTER` | Agent Starter | $19 / month |
| `STRIPE_PRICE_AGENT_PRO` | Agent Pro | $39 / month |
| `STRIPE_PRICE_TC_STARTER` | Coordinator Starter | $19 / month |
| `STRIPE_PRICE_TC_PRO` | Coordinator Pro | $39 / month |
| `STRIPE_PRICE_TC_TEAM` | Coordinator Team | graduated: $89 flat for 3 seats, then $30 per seat |
| `STRIPE_PRICE_BROKERAGE_BASIC` | Brokerage base (10 agents included) | $99 / month |
| `STRIPE_PRICE_BROKERAGE_BASIC_EXTRA_AGENT` | Brokerage extra agent | $15 / month each |
| `STRIPE_PRICE_BROKERAGE_PRO` | Brokerage Pro base (25 agents included) | $199 / month |
| `STRIPE_PRICE_BROKERAGE_PRO_EXTRA_AGENT` | Brokerage Pro extra agent | $20 / month each |

Fallbacks, so nothing breaks while you switch over: an unset agent variable uses the coordinator one, and an unset coordinator
variable uses the original shared `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` or `STRIPE_PRICE_TEAM`.

Brokerage billing is offered to an owner only when BOTH prices of that tier are set. Until then the owner sees "Request upgrade".

Use Secret or Config for the type; the `price_...` ids are not sensitive. Production gets live ids, Preview gets test-mode ids.

## How brokerage billing works

- The owner subscribes from Collaborate (after a pilot ends, or any time the account is not paid). Checkout charges the tier's base
  price, and the per-agent price for any extra agents already bought.
- Stripe confirms payment by webhook (`checkout.session.completed`); only then does the account become Brokerage / Brokerage Pro.
- Extra agents: the owner sets the number in Collaborate. Relay updates the subscription (prorated) and the seat allowance together.
- A cancelled or unpaid subscription pauses management and keeps every record, like an ended pilot. Subscribing again restores it.
- A paying brokerage owner is put on the **Brokerage** plan, a plan of its own, never Team. An owner who already pays for a Team
  subscription is left as they are (and a note is added to the account history): cancel Team in billing, then set Brokerage in Admin.
- A brokerage subscription ending never changes the owner's personal plan, so the owner can still open Collaborate and subscribe again.
- No new webhook events are needed: the existing endpoint already receives checkout, subscription updated and subscription deleted.
