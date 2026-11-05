# Pricing and entitlement structure (design, no billing)

Status: design for approval. Nothing here changes a route, the database, Stripe, or any production flag. The only code added is `src/lib/tiers.ts` (pure rules) and `tests/tiers.test.ts`; nothing imports them yet.

## 1. The model

These tiers are new and separate from the TC plans (Starter, Pro, Team). A brokerage owner keeps their TC plan; their brokerage tier is a different fact.

**Agents: three levels**

| Level | How they get it | What they can do |
|---|---|---|
| Guest | Free. Invited by a TC onto a specific deal. | Work on the deals they were added to: view, documents, key dates, messaging. Cannot create or run their own deals. |
| Basic | Free to the agent. Granted by a brokerage in good standing. | Everything in Guest, plus run their own deals (so the brokerage can see them). |
| Pro | About $19/month, optional. | Everything in Basic, plus their own CRM and contacts, follow-ups, templates and extra workflow features. |

An agent invited by a paying brokerage has Basic with no subscription of their own. Agent Pro is an optional personal upgrade.

**Brokerages: the difference is the level of operational control**

| Capability | Basic (about $99, 10 agents) | Pro (about $199, 25 agents) |
|---|---|---|
| Agent roster and invitations | Yes | Yes |
| Brokerage dashboard | Yes | Yes |
| Transaction visibility | Yes | Yes |
| Required-document review | Yes | Yes |
| Missing-document flags | Yes | Yes |
| Compliance templates | Basic: one required-document list for every file | Advanced: several lists by deal type |
| Agent-by-month CSV | Basic: fixed summary | Advanced: configurable, deal-level |
| Multiple administrators | Limited | Yes |
| Advanced permissions | No | Yes |
| Advanced analytics | No | Yes |
| Brokerage-wide checklist policies | Later | Later |
| Commission oversight (beyond today's statements) | Later | Later |

Extra seats are about $5 to $7 per agent per month on either tier. Prices stay out of the code until billing is built; only tiers, seat counts and feature gates are encoded.

**What distinguishes Basic reporting from Pro reporting.** Basic answers "what did each agent close each month": one fixed file, one row per agent per month, with closed deals and sales volume (what is built today). Pro answers "what is happening and why": you choose the date range and filters, get a row per deal rather than per month, add compliance status per file, compare agents and years, and later schedule it to arrive by email. The test is whether the broker can shape the report, not whether they can get one.

## 2. What exists today

- `app_metadata.plan` is one of starter, pro, team, brokerage. These are the **TC** plans. A brokerage owner today is simply a user on `team` or `brokerage` (`isTeamPlan`).
- `app_metadata.agent_workspace = true` is an admin grant that gives an agent their own workspace. `getEntitlements` turns it into `kind: 'agent_workspace'`, and only while the `agent_workspace` feature flag is on.
- A free agent portal login (`role: agent`, no grant) is a `collaborator`: works on deals a TC added them to.
- `brokerage_links` is the owner-to-agent relationship. The only seat rule is a flat cap of 200 (`MAX_LINKS_PER_OWNER`).
- Features are on or off per environment through `RELAY_FEATURES`. Production has `brokerage` and `agent_workspace` off.

## 3. Proposed structure

### 3.1 Brokerage side: one small table keyed by the owner

`brokerage_accounts` (new, additive, applied later with its own SQL file):

| column | meaning |
|---|---|
| `owner_user_id` (pk) | the brokerage owner |
| `tier` | `basic` or `pro` |
| `source` | `pilot` (complimentary, manual), `subscription` (later, written by the Stripe webhook), `admin` |
| `extra_seats` | whole number, default 0 |
| `pilot_ends_on` | optional date; blank means open-ended |
| `subscription_active` | stays false until billing exists |
| `created_at`, `notes` | audit and context |

The owner keeps their existing TC plan (`team`), so TC workflows and `isTeamPlan` do not change. A row in `brokerage_accounts` is what makes someone a brokerage in the new model. No row means no brokerage features, same as today with the flag off.

### 3.2 Agent side: derived, never copied

An agent's level is computed on read by `resolveAgentAccess`:

1. Own Agent Pro subscription (written by billing later) gives Pro.
2. Admin grant (today's `agent_workspace`) gives Pro. These are the complimentary agents you have now.
3. An active link to a brokerage in good standing gives Basic, source `brokerage`.
4. A TC invitation gives Guest (today's free portal login).
5. Otherwise none.

Nothing is stored on the agent for brokerage-granted access. When the agent leaves, is removed, or the brokerage lapses, it ends by itself. If the agent also pays for Pro, they keep Pro. When a brokerage lapses its agents lose the ability to start new deals, but every existing deal stays readable and nothing is deleted.

### 3.3 Seats

`limit = included (10 basic, 25 pro) + extra_seats`. Active agents plus pending invitations may not exceed it. A brokerage already over the limit after a downgrade cannot invite more, but no one is removed or locked out. This replaces the flat 200 cap.

### 3.4 Feature gates

Every capability asks one question (`brokerageHas(tier, feature)` or `agentHas(level, feature)`), so billing only changes the tier a person resolves to, never a route. The tables in section 1 are exactly what `src/lib/tiers.ts` encodes and `tests/tiers.test.ts` checks. Brokerage-wide checklist policies and wider commission oversight are listed as unreleased: on neither tier until they are built.

Numbers that differ by tier are proposed, not agreed: Basic keeps one required-document list and one extra administrator; Pro keeps ten lists and five extra administrators.

### 3.5 The complimentary pilot (built)

30 days of full Brokerage Pro, up to 25 agents, no payment method, no automatic billing, no automatic renewal. It starts the day an admin grants it (that is "successfully onboarded"). Stored in `brokerage_accounts` (`add-brokerage-accounts.sql`), kept apart from Stripe: the table has no billing fields and nothing here creates a charge or subscription.

| Status | Meaning | What the brokerage can do |
|---|---|---|
| `pilot` | Within the 30 days (or the extension) | Everything in Pro, up to 25 agents counting open invitations |
| `pilot_expired` | The end date has come | Read-only: see and export all agents, deals, reviews, commission records and history; message agents. Cannot invite, resend, change file-review settings or reviews, change base terms, or confirm and pay commissions. An upgrade request is offered. |
| `converted` | Admin recorded the move to paid Pro | Full Pro again |
| `terminated` | Admin ended it | Same read-only state; no upgrade offer, contact Relay |

Rules: the end date is 30 days after the grant and the account is treated as expired from that date even before the nightly job records it. One 15-day extension, by an admin, from an active pilot (adds to the end date) or an expired one (restarts for 15 days). Converting only records the decision and the date; payment is arranged separately and no Stripe object is touched. Nothing is ever deleted: expiry, termination and conversion all keep every record, and each step is written to `brokerage_account_events`.

Notices: a daily job (`/api/cron/brokerage-pilot`) emails and rings the owner at 14, 7 and 3 days before the end and on the day it ends, once each per end date; after a missed night only the most urgent notice is sent. Granting, extending, converting and terminating also notify the owner.

Admin controls (Admin page, "Brokerage pilots"): start a pilot by owner email (they must already be on the Team plan), extend, convert, terminate, see days left, agent counts and who asked to upgrade, and a list of owners who have agents but no account yet. The owner sees a banner on Collaborate with days left and a "Request upgrade" button that notifies every admin.

An owner with no account row is unchanged (behaves as today). Before the brokerage flag is turned on in production, every brokerage owner needs a row; the Admin page lists the ones that do not.

Not yet wired to the agent side: agents of an expired brokerage keep their access today. Making Basic agent access depend on the brokerage being in good standing is step 3 below.

## 4. Order of work after approval (each step small and testable)

1. **Table, pilot, admin controls, notices.** Built (section 3.5).
2. **Seat limit.** Built: the invite route enforces the account's seat allowance for owners with a row.
3. **Agent Basic via brokerage.** `assertWorkspaceAgent` also accepts an agent whose Basic comes from a brokerage (today it requires the admin grant), and the Pro-only agent features (contacts, templates, follow-ups) are gated behind `agentHas`. A Guest still cannot create deals. This is the one change to existing behavior and the one to review most carefully.
4. **Gates.** Wrap the Pro brokerage features in `brokerageHas` as each is built. Today's agent-by-month CSV, required-document review and flags are Basic, so nothing already built is taken away. During the pilot every account is Pro.
5. **Billing, later and separately.** Stripe writes `source: subscription` and `subscription_active`. No route changes.

Not touched in any step: TC plans and checklists, Stripe, production flags, deal privacy rules, the read-only broker rule.

## 5. Decisions

Settled by you: new tiers separate from the TC plans; Basic agents run their own deals; Guest agents (TC-invited) cannot create or run their own; reporting is split Basic/Advanced rather than all Pro; a lapsed brokerage cannot invite more agents but nothing is removed or deleted.

Still open, with a recommendation for each:

1. **Pilot tier.** Decided: 30 days of Pro.
2. **Listings.** Are they in Agent Basic? The broker's view includes listings, so I recommend yes. Agent invoices, AI contract intake and templates would then sit in Pro.
3. **"Limited" administrators on Basic.** I proposed one extra administrator on Basic and five on Pro. There is no multi-administrator feature built yet; it would be a new role on the owner's team.
4. **Today's commission statements.** They are built (broker confirms, agent accepts, broker marks paid). Your table puts commission oversight at "Later" for both tiers. I recommend leaving today's statements in Basic as they are and treating Step 2 and 3 (received and paid events, caps, co-agents, CDA export) as the later part. Say if you would rather hide statements until that is decided.
5. **One brokerage per agent.** Already enforced; confirm it stays the rule.
