# Pricing and entitlement structure (design, no billing)

Status: design for approval. Nothing here changes a route, the database, Stripe, or any production flag. The only code added is `src/lib/tiers.ts` (pure rules) and `tests/tiers.test.ts`; nothing imports them yet.

## 1. The model you described

| | Basic | Pro |
|---|---|---|
| **Agent** | Free when invited by a TC or a brokerage. Transactions, key dates, documents, messaging. | About $19/month, optional. Own workspace extras: CRM and contacts, follow-ups, templates, more workflow features. |
| **Brokerage** | About $99/month, 10 agents. Agent management, transaction visibility, file review, compliance tracking. | About $199/month, 25 agents. Adds advanced compliance, reporting, admin permissions, later brokerage-wide checklists. |
| **Extra seats** | About $5 to $7 per agent per month, on either brokerage tier. | |

Rule that drives the design: **an agent invited by a paying brokerage has Basic with no subscription of their own. Agent Pro is an optional personal upgrade.** Prices stay out of the code until billing is built; only tiers, seat counts and feature gates are encoded.

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

An agent's tier is computed on read by `resolveAgentAccess`:

1. Own Agent Pro subscription (written by billing later) gives Pro.
2. Admin grant (today's `agent_workspace`) gives Pro. These are the complimentary agents you have now.
3. An active link to a brokerage in good standing gives Basic, source `brokerage`.
4. A TC invitation gives Basic, source `coordinator_invite`.

Nothing is stored on the agent for the brokerage-granted case. When the agent leaves, is removed, or the brokerage lapses, the grant ends by itself. If the agent also pays for Pro, they keep Pro after leaving.

### 3.3 Seats

`limit = included (10 basic, 25 pro) + extra_seats`. Active agents plus pending invitations may not exceed it. A brokerage already over the limit after a downgrade cannot invite more, but no one is removed or locked out. This replaces the flat 200 cap.

### 3.4 Feature gates

Every capability asks one question (`brokerageHas(tier, feature)` or `agentHas(tier, feature)`), so billing only changes the tier a person resolves to, never a route.

Brokerage Basic: agent management, deal visibility, file review, compliance tracking (late items, closing this week, weekly digest), team messaging, commission statements.
Brokerage Pro adds: advanced compliance (reserved), reporting (the production CSV), admin permissions (reserved), checklist management (reserved).

Agent Basic: deal visibility, documents, key dates, messaging, own deals. Agent Pro adds CRM and contacts, follow-ups, templates, workflow extras.

### 3.5 Pilot

First brokerages are onboarded by inserting one `brokerage_accounts` row (`source: pilot`). The recommendation is to give pilots `tier: pro` so they see everything you may charge for, with `pilot_ends_on` set so the end of the pilot is a date, not a surprise. Their agents get Basic through the link with no payment step.

## 4. Order of work after approval (each step small and testable)

1. **Table and read helper.** `add-brokerage-accounts.sql`, `getBrokerageAccount(ownerId)`, a script to grant a pilot. No route changes.
2. **Seat limit.** The invite route uses `canInviteAnother`. Behavior for existing owners with a row only.
3. **Agent Basic via brokerage.** `assertWorkspaceAgent` also accepts an agent whose Basic comes from a brokerage (today it requires the admin grant). This is the one change to existing behavior and the one to review most carefully.
4. **Gates.** Wrap the Pro-only brokerage features (production CSV) in `brokerageHas`. During the pilot every account is Pro, so nobody notices.
5. **Billing, later and separately.** Stripe writes `source: subscription` and `subscription_active`. No route changes.

Not touched in any step: TC plans and checklists, Stripe, production flags, deal privacy rules, the read-only broker rule.

## 5. Decisions I need from you

1. **Where a brokerage tier lives.** Recommended: the new table, TC plan stays `team`. The alternative is new hidden plan ids (`brokerage_basic`, `brokerage_pro`) in `plans.ts`, which touches every `isTeamPlan` check.
2. **Pilot tier.** Pro for everyone in the pilot (recommended), or Basic.
3. **Do Basic agents run their own deals?** The brokerage sees an agent's deals only if the agent has a workspace. I assumed Basic includes creating and running their own deals; Pro is the CRM, follow-ups, templates and extras. If Basic instead means "view only what a TC or broker adds", the broker would see nothing for agents who have no deals of their own.
4. **Production CSV is Reporting, so Pro.** It is built and works today; it would be gated only once billing exists. OK, or should it stay in Basic?
5. **On a lapse.** Recommended: the broker's agent management and the agents' existing deals stay readable, new invitations stop, and nothing is deleted. Confirm.
6. **One brokerage per agent.** Already enforced. Confirm this is the rule for now.
