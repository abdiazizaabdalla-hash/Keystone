# Launch plan: coordinators, agents, brokerages (and the new website)

Nothing here has been pushed, and nothing here touches Stripe or production. Each step marked **YOU** needs you.

## What is BUILT and what is PLANNED

| | BUILT | PLANNED (not built) |
|---|---|---|
| Coordinators | Templates on every plan; automations on Pro/Team; Settings pause switch; other invoices; archive; free agent login chosen deal by deal (Agents page → Portal access); auto-add of agents who already have access | Listing automations, action queue, library rewrite (deliberately skipped until the pilot) |
| Teams | Team plan ($89, 3 seats, $30 extra), board, shared contacts, owner report | n/a |
| Agents | Workspace provided by a brokerage (Agent Basic); admin-granted Pro workspace | **Agent Pro self-subscription ($19)**: no checkout, so the site sends people to a pilot form |
| Brokerages | 30-day pilot with admin controls and notices; roster, dashboard, deal visibility, document review and flags, messaging, commission statements, agent-by-month export | **Paid Brokerage Basic/Pro billing**; the Basic/Pro feature gates (`brokerageHas` is not called anywhere yet); Pro extras (several document lists, configurable reports, analytics, scoped admin roles) |

## Prices on the site (copy only, nothing bills)

Coordinators: Starter $19, Pro $39, Team $89 for 3 seats ($30 each extra). Agent Pro $19. Brokerage Basic $99 (10 agents), Pro $199 (25 agents), extra agents $6. Change them in `src/lib/marketingPricing.ts` and `src/lib/plans.ts`.

## Step by step

### A. Coordinators (this is the real launch)
1. **YOU** Back up the production database (Supabase → Database → Backups).
2. **YOU** Run `docs/release/00-check-production.sql`, then `01-migrations-all.sql`, then `00-check-production.sql` again. See `docs/RELEASE_RUNBOOK_TC_LAUNCH.md`.
3. **YOU** Push `preview/agent-invoices-and-stripe` and open the Vercel preview. Smoke test with a Pro and a Starter account: templates visible on both; Automations tab, deal automation controls and the Library only on Pro/Team; Settings → Automation card on both (Starter sees the upgrade note); Portal access dialog on the Agents page; new deal for an agent who already has access (box says "tick to keep this off their portal").
4. **YOU decide first:** the branch also carries Stripe Connect changes (agent workspace invoice webhook). Approve them, or split them out.
5. **YOU** Merge to `main`. Vercel redeploys production.
6. **YOU** Set production environment variables `RELAY_FEATURES` and `NEXT_PUBLIC_RELAY_FEATURES` to `automation,templates,other_invoices`, then **redeploy** (the public one is baked in at build). Leave `agent_workspace` and `brokerage` off for now.
7. **YOU** Run `add-automation-schedule.sql` for the hourly automation tick.
8. Production smoke test, then tell your coordinators. The new website goes live with step 5.

### B. Brokerages (pilot, after A is stable)
1. **YOU** Add `brokerage` to both feature variables, redeploy.
2. **YOU** In Admin → Brokerage pilots, start a pilot for each owner by email (they must be on Team). Every owner with agents needs a row before the flag is on; the page lists the ones that do not have one.
3. The site's "Start a free 30-day pilot" button sends you a request by email.

### C. Agents (pilot, with brokerages)
1. **YOU** Add `agent_workspace` to both feature variables, redeploy.
2. Brokerage-invited agents get their workspace from the brokerage automatically. For an agent who wants Agent Pro, grant the workspace from Admin; the site's "Join the Agent Pro pilot" button sends you the request.

### D. Billing (later, **needs your approval before I touch Stripe**)
Agent Pro checkout, brokerage subscriptions, and writing `subscription_active`. Until then everything for agents and brokerages is a pilot.

## Before you announce, check the site
- Home, For Coordinators, For Agents, For Brokerages, Pricing, FAQ at production; `/for-teams` and `/for-agents/portal` redirect to the coordinator page.
- The free agent login and Team are described only on For Coordinators (and the FAQ's coordinator sections).
- Decide whether to keep the "Agent Login" link in the header (it is a login, not marketing).
