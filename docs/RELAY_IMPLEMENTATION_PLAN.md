# Relay Implementation Plan: Two Customers, One Free Collaboration Role

Status: PLAN FOR REVIEW. Nothing in this document has been built. No production data, billing, Stripe, or pricing was touched in producing it.

Companion documents: `docs/RELAY_PRODUCT_EXPANSION_BLUEPRINT.md` (audit and feasibility), `docs/EXPANSION_PLAN.md` (first-pass notes, now partly superseded by this plan).

---

## 0. Summary in one page

Your revised model has three kinds of people on one platform:

1. **TC subscriber**: pays for a TC workspace, owns the transactions they run, invites agents for free.
2. **Agent subscriber**: pays $29 (proposed, not approved) for an independent agent workspace, owns the transactions they create, can invite a TC.
3. **Free agent collaborator**: invited by a TC, can work only on the deals shared with them, cannot start their own.

The design rule that keeps this non-confusing: **a person has one login; what they can do on their own is decided by their entitlement; what they can do on someone else's deal is decided by their role on that deal.** Those two things never mix.

What the code looks like today against that rule:

- The **free collaborator already exists** and works: the `/agent` portal, `transaction_agents`, `assertAgentOnTransaction`, `app_metadata.role = 'agent'`. It is the thing to protect.
- The **TC workspace already exists** and is the one place `transactions.tc_user_id` means "the account that runs this deal".
- The **agent subscriber does not exist**. My earlier first pass (commit ec55cb8) approximated it by letting an agent sign up into a normal Starter workspace with a 30-day trial. That does not match your model and must be reworked before it ships.
- There is **no way for anyone except the owning TC to be on a deal as a manager**. An agent-owned deal with an invited TC needs a new participants model.
- There is **one real gap today** that your brief says must never exist: nothing stops a free collaborator from creating their own agents and transactions by calling the API directly (details in section 2).

What I recommend building first, in order:

1. Close the free-independent-use gap and add the safety net (tests, a route registry, one central authorization module). No new features.
2. Entitlements, then the agent workspace, with agent access granted by an admin flag so nothing depends on Stripe.
3. Shared deals in both directions (`transaction_participants`).
4. Billing for the agent plan only after the access model is tested and you approve the entitlement rules.

Ten decisions I need from you are listed in section 12. Four of them block Phase 1 or 2.

---

## 1. Verified starting state

Verified in the repository (branch `main`, working tree clean apart from the `Claude outputs/` folder):

- Auth is Supabase Auth. Every API route calls `getUserFromRequest` (`src/lib/auth.ts`). There is no middleware or proxy file. Database access uses the service-role client everywhere, and the earlier row-level-security policies are inert because `lock-down-database-access.sql` revokes client grants. **Authorization is entirely application code.**
- 155 `route.ts` files under `src/app/api`. 90 of them reference `tc_user_id`; 29 use `getVisibleTcUserIds`; 20 reference `transaction_agents`; 73 files reference the agent role, some only for display.
- Plans are in `src/lib/plans.ts`: `starter | pro | team | brokerage`. The plan lives in `app_metadata.plan` (server-only). Trial logic is `src/lib/trial.ts`: Starter only, 30 days, accounts created on or after 2026-09-23; `assertTrialActive` is called at the top of mutating routes (109 occurrences across 53 files).
- Stripe: `src/app/api/stripe/{checkout,portal,webhook,connect}`. The webhook is the only place a plan is granted. It handles `checkout.session.completed`, `customer.subscription.updated/deleted`, `charge.refunded`. Checkout accepts only `starter | pro | team | brokerage`.
- The free collaborator: `agent_invites`, `transaction_agents (transaction_id, agent_user_id, invited_by)`, `/api/agent/*`, `/agent/*` pages, `assertAgentOnTransaction`.
- `createAgentLoginLink` (`src/lib/agentInvite.ts`) refuses to invite an email that already belongs to a non-agent login (`other_account`). This is the code that currently makes "one identity, several roles" impossible.
- No automated tests exist. 59 SQL files at the repo root; the `teams`, `team_members`, `team_invites` definitions are not among them (schema drift).

**Not verified, and I will not assume:**

- What is deployed. Commits 4b28a4a, 5b4ccd2, ec55cb8 and db4dac5 are local; you push them. I cannot see Vercel.
- The production database schema, existing Stripe products/prices/subscriptions, or real customer rows.
- Whether any real account has already signed up through the first-pass agent path.
- A full sweep of every mutating route for the collaborator gap (I confirmed two; the sweep is Phase 1 work).

### What the first pass (ec55cb8) did that conflicts with the new model

| First-pass behavior | Files | Conflict |
|---|---|---|
| Agent signup creates a normal workspace on the Starter plan with a 30-day trial | `src/app/auth/page.tsx`, `src/app/api/auth/signup/route.ts`, `src/app/onboarding/agent/page.tsx`, `src/app/api/agent-onboarding/route.ts` | Gives independent agent use with no agent subscription. After the trial the agent would be asked to pay the TC price ($19). |
| `account_type` stored in `user_metadata` (user-editable) | `src/lib/accountType.ts`, `/api/auth/me` | Safe only because it is presentation. An entitlement must live in server-only `app_metadata`. |
| Agents get a self `agents` row (`flat_fee 0`) so `transactions.agent_id NOT NULL` is satisfied | `src/app/api/agent-onboarding/route.ts` | Reasonable and reusable, but it counts toward the Starter 3-agent-profile cap. |
| Marketing says agents can "sign up and use the full site" | `src/app/page.tsx`, `/for-agents`, `/pricing` | Does not distinguish free collaboration from a paid agent workspace. |

Because none of this is deployed, it can be corrected before it goes live. Recommendation in Phase 0.

---

## 2. A gap that exists today (found during this review)

`POST /api/agents` and `POST /api/transactions` only call `getUserFromRequest` and `assertTrialActive`. Neither rejects an account with `app_metadata.role = 'agent'`. (`POST /api/listings` does reject agents; it is the model to copy.)

A free collaborator account has the default plan (`starter`) and, if created after 2026-09-23, is inside its 30-day clock. Calling those two endpoints directly with their own token would let them create an agent profile and then a transaction in a private workspace, for free, for 30 days. The portal UI never offers this, which is why it has not been noticed, but the API allows it.

This is exactly "free collaboration must not mean free independent use". It is the first thing to close, it needs no billing decision, and it needs a test that proves it.

I have not changed it, per the audit-only instruction.

---

## 3. The model: identity, entitlement, participation

Three separate questions, answered in three separate places.

| Question | Answered by | Stored in |
|---|---|---|
| Who is this person? | Supabase Auth user (one per email) | `auth.users` |
| What can they do **on their own**? (create deals, run invoicing, etc.) | **Entitlement** | `app_metadata` (server-only), later backed by Stripe |
| What can they do **on this deal**? | **Role on the transaction** | `transactions.tc_user_id` (owner), `transaction_participants` (everyone else) |

### Entitlements (v1)

New module `src/lib/entitlements.ts` exposes a single function, `getEntitlements(user)`, returning:

- `tcWorkspace`: true when the account has a TC plan (today's `app_metadata.plan` logic, unchanged).
- `agentWorkspace`: true when `app_metadata.agent_workspace` is set. Set by an admin tool first and by the Stripe webhook later. **No Stripe change is needed to build and test this.**
- `collaboratorOnly`: has `role = 'agent'` or participant rows, and neither workspace flag.

Backward compatibility rule: **an account with no new flags behaves exactly as it does today.** Every existing non-agent account keeps its TC workspace. Every existing `role = 'agent'` account stays a collaborator.

`role = 'agent'` currently means "portal only". It will stop being exclusive: the places that call `isAgentUser` or check `role` get reviewed and re-expressed as `collaboratorOnly` (portal-only) or as a participant check, so an upgraded agent can have both.

### Workspace

In v1 the workspace **is the owner's user id**, which is what `transactions.tc_user_id` already holds. I am deliberately not introducing a `workspaces` table now: 114 source files use `tc_user_id`, and renaming or re-keying it is the highest-risk change available for the least benefit. A `workspace_owner_id` alias (comment plus helper, no column rename) documents the meaning. A real `organizations` table arrives with the brokerage phase, when it is actually needed.

An agent subscriber's transactions therefore use the same column and the same engine. `getVisibleTcUserIds(agentId)` already returns `[agentId]`, so their own list, tasks, documents and calendar work with the existing queries.

### One workspace per login in v1 (decision D4)

The schema does not forbid one person holding both a TC and an agent workspace. The first release supports one independent workspace per login plus unlimited collaboration roles. Dual workspaces need `stripe_customers` to hold two subscriptions per user (it is one row per `user_id` today), which is a billing change, so it waits.

---

## 4. The twelve questions

### Q1. How does Relay tell a TC subscriber, an agent subscriber and a free collaborator apart?

| Person | `getEntitlements` | Lands on | Can create deals? |
|---|---|---|---|
| TC subscriber (all existing non-agent accounts) | `tcWorkspace` | `/dashboard` | Yes |
| Agent subscriber | `agentWorkspace` | `/dashboard` in agent presentation | Yes |
| Free collaborator | `collaboratorOnly` | `/agent` (existing portal) | No |
| Person with a workspace and shared deals | workspace flag plus participant rows | their dashboard, with a "Shared with you" section | Own deals only |

Presentation (navigation, wording) follows entitlement. Authorization never reads `user_metadata`. The first-pass `account_type` in `user_metadata` stays as a cosmetic hint only; the real flag moves to `app_metadata`.

### Q2. How do subscriptions relate to workspaces and users?

User and workspace are one-to-one in v1 (the workspace key is the user id). A subscription grants an entitlement to that user. Team plans keep the existing owner/member model. Invited collaborators never consume a paid seat (`getPaidSeatCount` in `src/lib/team.ts` counts team members only; participants are a different table and are not read by it). Section 8 spells out the agent-profile cap, which is the one place a collaborator can be mistaken for a cost.

### Q3. How is an agent prevented from creating transactions without an active agent subscription?

Server-side, in one choke point. `assertTrialActive` is already the first call in every mutating route (109 call sites in 53 files). I will add `assertCanOperateWorkspace(user)` in `src/lib/entitlements.ts` and call it from inside `assertTrialActive`, so all existing call sites inherit it without 50-plus file edits. It throws a 403 with a stable code `WORKSPACE_REQUIRED` when the account is `collaboratorOnly`.

Collaborator writes that are legitimate (completing an assigned task, uploading a requested document, messaging) must keep working. Those go through the agent branches of shared routes (`documents`, `messages`, `tasks`, `key-dates`, `contacts`) and `/api/agent/*`. Phase 1 starts by writing tests that pin down that these still pass, then makes the change.

Front end: on `/agent` there is no "new transaction" action. If a collaborator reaches a create screen by URL, they see the upgrade explanation from your brief, not an error.

### Q4. How does a free collaborator upgrade without losing identity or shared deals?

Same auth user, same id. Upgrade sets `app_metadata.agent_workspace = true` (admin now, webhook later). Nothing in `transaction_agents` or `agent_invites` is touched, so every existing shared deal keeps working. After the flag flips, the user sees "My transactions" and "Shared with you" side by side. The only code that has to change is anywhere `role = 'agent'` is treated as "this person has no workspace" (the `isAgentUser` call sites, listed in section 6).

### Q5. How does a paid agent invite a TC to an agent-owned deal?

New endpoint `POST /api/transactions/[id]/participants` (owner or manager only) creates a `transaction_invites` row and emails the TC. Acceptance is `POST /api/participants/accept` and is idempotent.

- If the TC already has a Relay login, the invite attaches to that login. They do not get a second account. This needs `createAgentLoginLink`'s `other_account` refusal replaced by "attach to the existing user".
- The deal appears in the TC's workspace under **Shared with you**, not mixed into the deals they own, so TC reports, invoices and plan limits stay clean.
- A TC without a subscription: this is the unresolved edge case (decision D1). My recommendation matches yours: a limited transaction-level role, `managing_tc_guest`, with checklist, dates, documents, messages and email on that one deal, and none of the TC workspace (no invoicing, CRM, templates, other deals, team). That guest role is where "upgrade to a TC plan" is offered.

### Q6. How does a TC invite a free agent to a TC-owned deal?

This already works and is untouched: `POST /api/agent-invites`, `agent_invites`, `transaction_agents`, `/agent/accept`. Phase 3 dual-writes a matching `transaction_participants` row (role `agent`) so both models agree, then moves reads over route by route. `transaction_agents` stays authoritative until the participants model has passed its tests.

### Q7. How are duplicate accounts and duplicate transactions avoided?

- One auth user per lower-cased email. Invites resolve by email to an existing user; they never create a second one.
- One `transactions` row per deal. Joining a deal adds a `transaction_participants` row, nothing else. `UNIQUE (transaction_id, user_id)`.
- Accepting an invite twice is a no-op.
- A TC who creates a deal for a property an agent already owns: `findOpenTransactionDuplicate` (`src/lib/duplicates.ts`) is the existing building block. Phase 3 extends it to say "an open deal for this address already exists in Relay" and offer to request access, instead of silently creating a second one. Deliberately conservative: it never reveals who owns it.
- The TC's own `agents` (CRM contact) row for a paying agent is optional and never auto-created from a participant row.

### Q8. How are existing TC subscriptions and the free agent portal preserved?

- No change to `plans.ts` prices, Stripe routes, webhook, trial dates, or `trial.ts` behavior for existing accounts until billing is approved (Phase 4).
- Migrations are additive only (new tables, no column drops, no renames, no backfill that rewrites `transactions`).
- Absence of a new flag means today's behavior.
- Characterization tests are written before any change, so a regression shows up as a failing test.
- `/agent/*`, `/api/agent/*`, `agent_invites`, `transaction_agents` are not modified in Phases 1 to 2.

### Q9. How does authorization work across the existing routes?

Today each route does its own check (11 routes have a local helper such as `assertOwnsTransaction`, `loadTransactionForAccess`, `assertCanAccessTransaction`; many inline the check). I will not rewrite 155 routes at once.

1. New module `src/lib/authorize.ts`: `authorizeTransaction(user, transactionId, action)` returns `{ role, via }` or throws. Order: owner (`tc_user_id` in the caller's visible ids) then participant row then legacy `transaction_agents` then deny. A single capability matrix maps `role x action`.
2. A **route registry test** (no database needed) walks every `route.ts` and requires each to be listed with a category: `authorize`, `owner-scoped`, `agent-portal`, `public-token`, `cron`, `admin`, `webhook`. A new route that is not registered fails the test. This turns "deny by default" into something enforced.
3. Migrate the shared transaction surfaces first, because they are where collaborators and owners meet: `documents`, `tasks`, `messages`, `key-dates`, `transactions/[id]/contacts`, `external-links`, `send-step-email`, `calendar-sync`, `signing-requests`, `agent-invites`.
4. Remaining owner-scoped routes keep working and are migrated opportunistically; the registry records which have been.

### Q10. What database changes are needed?

All additive. SQL sketches are in section 7. Summary: `transaction_participants`, `transaction_invites`, entitlement flag in `app_metadata` (no table), reuse of `audit_log` for transaction events, and later (billing phase only) a table for per-product subscriptions.

### Q11. What tests verify each user type sees only the right things?

Section 9.

### Q12. What can be reused rather than rebuilt?

| Need | Reuse |
|---|---|
| Collaborator portal | `src/app/agent/*`, `src/app/api/agent/*`, `src/lib/agentPortal.ts` |
| Invite emails and login links | `src/lib/agentInvite.ts`, `agentPortalEmails.ts`, `agentLoginToken.ts` (needs the existing-account change) |
| Transaction engine for agent-owned deals | `/api/transactions`, `tasks`, `documents`, `key-dates`, `checklist-templates`, `extract-contract` (all keyed on `tc_user_id`) |
| Dashboard shell for the agent workspace | `src/app/dashboard/layout.tsx` (already hides Invoices and Agents for agent presentation), `src/lib/persona.ts` |
| Self `agents` row | `src/app/api/agent-onboarding/route.ts` |
| Client portals and e-sign | `external_access_links`, `signing_requests`, `/sign/[token]` |
| Audit trail | `src/lib/audit.ts` and `audit_log` |
| Duplicate detection | `src/lib/duplicates.ts` |
| Rate limiting, AI usage logging | `src/lib/rateLimit.ts`, `src/lib/aiUsage.ts` |

---

## 5. Making it non-confusing: one Relay, two sides

You asked for the TC side and the agent side to sit under one Relay umbrella without confusing anyone. The rules I propose:

1. **One sign-in page, one app, one design.** Nobody is asked to "pick a product" after they are in. The choice is made on the public site ("I'm a TC" / "I'm an agent") and from then on follows what they own.
2. **Three words, used the same everywhere:** *Your workspace* (what you pay for and own), *Shared with you* (deals someone else owns), *Collaborator* (a free guest on someone's deal). No "account type" toggle after signup; a toggle looks like a role you can flip, and it is not.
3. **Every deal shows who owns it and who manages it** ("Owned by Riley Morgan, coordinated by Summit Closing Team"), so a shared deal is never mistaken for your own.
4. **Navigation by entitlement**, reusing today's layouts: TC workspace (unchanged), agent workspace (Home, My Transactions, Listings, Tasks, Calendar, Documents, Clients, TC Collaboration, Settings), collaborator view (the existing `/agent` portal, deliberately simple).
5. **The upgrade message appears only when a collaborator tries to start their own deal**, using the wording in your brief. No banners while they are doing work on a shared deal.
6. **Pricing page starts with an audience selector** (TC / Agent) and states plainly that invited agents collaborate free; building it waits for Phase 4.
7. **Public pages stay `/for-tcs`, `/for-agents`, `/for-brokerages`** (the routes that exist). Your longer names can be redirects. Note `/for-agents` today describes self-serve signup and must be rewritten to match this model; the old free-collaborator page lives at `/for-agents/portal`.

---

## 6. Files, routes, tables and components affected

Grouped by phase. "Change" means modified; "New" means created.

**Phase 0 (reconcile the first pass, before anything is pushed)**

- Change: `src/app/auth/page.tsx`, `src/app/onboarding/agent/page.tsx`, `src/app/api/auth/signup/route.ts`, `src/app/api/agent-onboarding/route.ts`: gate the self-serve agent path behind an env flag `AGENT_SELF_SERVE_ENABLED` (default off).
- Change: `src/app/page.tsx`, `src/app/for-agents/page.tsx`, `src/app/pricing/page.tsx`, `src/components/PublicHeader.tsx`: copy that does not promise self-serve agent signup; offers an early-access request instead (reuses `api/demo-request`).

**Phase 1 (foundations)**

- New: `vitest` config and test folder; `src/lib/entitlements.ts`; `src/lib/authorize.ts`; route registry file and test; schema snapshot doc.
- Change: `src/lib/trial.ts` (`assertTrialActive` calls the workspace check first), `src/app/api/agents/route.ts`, `src/app/api/transactions/route.ts` (covered by the above).
- Change: `src/lib/privileged.ts` (add `hasAgentWorkspace`), `src/lib/agentPortal.ts` (document the new meaning of `isAgentUser`).

**Phase 2 (agent workspace)**

- Change: `src/app/api/auth/me/route.ts` (return entitlements), `src/app/dashboard/layout.tsx` and `src/lib/persona.ts` (derive presentation from entitlements), `src/app/dashboard/page.tsx` (agent home: attention, deadlines, documents, "what is my TC handling"), `src/app/api/agent-onboarding/route.ts`.
- Change: the agent-role checks (73 files reference it; notably `api/documents`, `api/messages`, `api/search`, `lib/clientMessages.ts`, `api/transactions/[id]/*`) so an upgraded agent is not treated as portal-only.
- New: admin action to grant the agent workspace (`src/app/api/admin/users/[id]/route.ts` already edits `app_metadata` for trial overrides; same pattern).
- New: upgrade explainer screen shown when a collaborator reaches a create flow.

**Phase 3 (shared collaboration)**

- New tables, `src/app/api/transactions/[id]/participants/route.ts`, `src/app/api/participants/accept/route.ts`, "Shared with you" list endpoint and page, TC Collaboration page for agents.
- Change: `src/lib/agentInvite.ts` (attach to existing user instead of refusing), `src/app/api/agent-invites/route.ts` (dual-write), `src/lib/duplicates.ts`.
- Change: the shared-surface routes listed in Q9 to call `authorizeTransaction`.

**Phase 4 (billing, only after approval)**

- Change: `src/lib/plans.ts` (agent plan entry), `src/app/api/stripe/checkout/route.ts`, `src/lib/stripe.ts`, `src/app/api/stripe/webhook/route.ts` (sets the same flag), `src/app/pricing/page.tsx` (audience selector). Needs a new Stripe product and price created by you or with your sign-off.

---

## 7. Database changes (all additive; nothing runs until you approve)

```sql
-- Who is on a deal besides its owner. The owner stays implicit in transactions.tc_user_id,
-- so no existing row is rewritten and no backfill of owners is needed.
create table if not exists public.transaction_participants (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  user_id        uuid not null,
  role           text not null check (role in ('tc','agent','assistant','viewer')),
  permissions    jsonb not null default '{}'::jsonb,   -- per-deal overrides, empty by default
  status         text not null default 'active' check (status in ('active','removed')),
  added_by       uuid,
  created_at     timestamptz not null default now(),
  removed_at     timestamptz,
  unique (transaction_id, user_id)
);
create index if not exists idx_tp_user on public.transaction_participants (user_id) where status = 'active';

-- Invitations for people who may not have a login yet (generalizes agent_invites).
create table if not exists public.transaction_invites (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  email          text not null,                         -- stored lower-cased
  role           text not null check (role in ('tc','agent','assistant','viewer')),
  status         text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by     uuid not null,
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  unique (transaction_id, email)
);

alter table public.transaction_participants enable row level security;
alter table public.transaction_invites      enable row level security;
-- No grants to anon/authenticated: same lock-down as every other table (lock-down-database-access.sql).
```

Notes:

- The "limited guest TC" is not a stored role. A participant with role `tc` is treated as a guest or a full TC by checking their **entitlement at request time**, so when a guest later buys a TC plan nothing has to be migrated.
- Transaction events reuse `audit_log` (`src/lib/audit.ts`) instead of a new table in Phase 1.
- Entitlements are `app_metadata` flags in Phases 1 to 3. A per-product subscriptions table is only designed in Phase 4, because it touches billing.
- Rollback for every change above is `drop table`; nothing else references these tables until the feature flag is on.
- Before any migration runs I need the production schema reconciled with the repo (decision D6). The `teams`, `team_members`, `team_invites` definitions are missing from the repo today. Deliverable: `docs/schema-snapshot.sql` plus a migration verification query file.

---

## 8. Billing, limits and the six scenarios

Checked against the code and your table:

| Scenario | Works with current code? | What is needed |
|---|---|---|
| TC invites agent, agent pays $0 | Yes (`agent_invites`, `transaction_agents`) | Nothing; protect with tests |
| Agent uses Relay alone, pays | No | Agent entitlement and workspace (Phase 2), billing (Phase 4) |
| Paid agent invites TC | No | Participants and invites (Phase 3) |
| Paid TC and paid agent share a deal | No | Participants (Phase 3) |
| Free agent tries to create their own deal | **Allowed today by the API** | Close the gap (Phase 1) |
| Existing Relay user accepts an invite | Blocked for non-agent logins (`other_account`) | Attach to the existing user (Phase 3) |

**Agent-profile cap is the one place a free collaborator can look like a cost.** `maxAgents` (Starter = 3, `plans.ts`, enforced in `api/agents/route.ts` and `api/quickbooks/import/route.ts`) counts rows in `agents`, which are a TC's CRM contacts. Inviting an agent to a deal requires an `agents` row because `transactions.agent_id` is `NOT NULL`. So a Starter TC with three agent contacts cannot add a fourth even though the agent collaborates free. The cap is a contact limit, not a collaborator fee, and I would leave it unchanged and say so in the pricing copy (decision D7). Participants on deals a TC does not own are never rows in the TC's `agents` table, so they are not counted. Team seats are unaffected; `getPaidSeatCount` only counts team members.

**Agent plan ($29, proposed):** `PlanId` is a closed union used in `plans.ts`, `stripe.ts`, the checkout route and the webhook. Adding `agent` is a Phase 4 change. Until then agent access is an admin-set flag, so the whole access model can be built and tested without creating a Stripe product.

---

## 9. Test strategy

There are no tests today, so the first deliverable is the harness and a safety net, not new behavior.

**Tooling.** Vitest. Pure-logic tests need nothing else. Integration tests need a database that is not production (decision D5).

**Test actors:** TC A, TC B (unrelated), Team member of TC A, agent subscriber, collaborator invited by TC A, unrelated collaborator, TC guest on an agent-owned deal.

**Layers**

1. **Route registry test** (no database): every `route.ts` is categorized; unregistered routes fail.
2. **Capability matrix unit tests:** every `role x action` cell in `authorize.ts`, including the deny cells.
3. **Entitlement unit tests:** all combinations of flags, plus "no flags behaves like today".
4. **Cross-account integration tests:** each actor tries each shared-surface route against deals they do and do not belong to (read, write, delete, list). Expectation is explicit per cell.
5. **Characterization tests** written first for current behavior: collaborator can complete assigned tasks, upload and message; owner flows; trial gate for Starter; portal login.
6. **Webhook snapshot test:** replays `checkout.session.completed`, `customer.subscription.updated/deleted`, `charge.refunded` fixtures and asserts plan/team outcomes are identical before and after.

**Your twelve ownership scenarios map one-to-one to integration tests:** (1) TC creates and invites agent; (2) agent creates and invites TC; (3) TC accepts an agent-owned deal; (4) agent removes or replaces their TC; (5) TC removes an agent; (6) assistant with limited access; (7) two subscribers on one deal; (8) free collaborator upgrades; (9) closed deal retains history; (10) one participant loses access without affecting others; (11) a user with several workspaces and shares; (12) role or organization change. Each asserts no duplicate `transactions` row and an `audit_log` entry.

**Gate:** no phase merges with a failing registry or cross-account test.

---

## 10. Phased plan, dependencies and effort

Effort is in engineering days, estimated, not committed.

| Phase | Scope | Days | Depends on | Ships to users? |
|---|---|---|---|---|
| 0 | Reconcile first pass: flag the self-serve agent path, fix public copy | 1 to 2 | D3 | Yes (copy only) |
| 1 | Test harness, characterization tests, route registry, close the collaborator gap, `entitlements.ts`, `authorize.ts` on shared surfaces, schema snapshot | 10 to 14 | D2, D5, D6 | Gap fix only |
| 2 | Agent workspace: entitlement grant (admin), agent nav and home, upgrade explainer, `isAgentUser` review, server-side entitlement replaces `user_metadata` hint | 10 to 14 | Phase 1, D2, D4 | Admin-granted agents only |
| 3 | Shared deals both directions: participants, invites, "Shared with you", TC Collaboration, duplicate guard, dual-write from `transaction_agents` | 15 to 20 | Phase 1 to 2, D1, D9 | Behind a flag |
| 4 | Agent billing: Stripe product and price, checkout, webhook flag, pricing audience selector, trial rules, upgrade and downgrade | 5 to 8 | Phase 3 tested, explicit approval, D8, D10 | Yes |
| 5 | Automation roadmap (extraction confidence, missing-document detection, email matching, approved follow-ups) | per blueprint | Phase 3 | Incremental |
| 6 | Brokerage organization product | per blueprint | Customer validation | Later |
| 7 | Integrations | per blueprint | Demand | Later |

Phases 0 to 4 together are roughly 41 to 58 engineering days. Phase 1 is the longest pole for risk, not size; it is what makes every later phase safe.

**Approval gates:** after each phase I stop and report what changed, what works, what remains, and any staging or production step you must take (migrations, env vars, deploys). I do not start the next phase without your go-ahead.

---

## 11. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Authorization is spread over ~155 routes | A missed route leaks data once deals are shared across accounts | Registry test, shared surfaces first, deny by default |
| `role = 'agent'` is treated as "no workspace" in up to 73 files | Upgraded agents could be locked into the portal or, worse, a collaborator gain too much | Review every call site, tests on both states |
| Closing the collaborator gap breaks a legitimate collaborator write | Real agents would see errors | Characterization tests first; gate only workspace-creating routes |
| Existing logins refused as invitees (`other_account`) | Blocks "one identity, several roles" | Change in Phase 3 with tests; keep refusal for unverified cases |
| Schema drift (teams DDL not in repo) | Migrations could assume wrong state | Snapshot production first (D6) |
| First-pass agent signup ships before the model is settled | Agents get a Starter-priced path you do not intend | Phase 0 flag before you push |
| Service-role client everywhere | One bug bypasses everything | Central `authorize`, tests, no new direct queries in new routes |
| Billing changed before access model is proven | Hard to unwind customers | Phase 4 only after Phase 3 passes and you approve |
| Orphaned deals when an agent subscriber cancels | TC and client lose access mid-deal | Decide retention rule (D9) before Phase 4 |

---

## 12. Decisions I need from you

Blocking Phase 0 to 2:

- **D2. Interim agent access.** Until billing exists, how do agents get the agent workspace? Recommended: admin-granted only (you grant specific early agents). Alternative: a free 30-day trial like Starter.
- **D3. The first-pass self-serve agent signup.** Recommended: put it behind a flag, off, until Phase 2, and change the public copy to an early-access request. Alternative: leave it live.
- **D5. A non-production database for tests.** A Supabase branch or a second free project. Without it I can still ship the registry, matrix and entitlement tests, but not cross-account integration tests.
- **D6. A schema-only dump of production.** Run `pg_dump --schema-only` (I can give the exact command) or give me read access to the Supabase SQL editor so I can reconcile the missing team tables.

Blocking Phase 3:

- **D1. TC invited onto an agent-owned deal who does not subscribe.** Recommended (and your lean): limited per-deal access, no TC workspace features, upgrade offered inside it.
- **D9. What happens to an agent-owned deal if the agent cancels.** Recommended: deal stays accessible to participants, owner goes read-only for a defined period, nothing is deleted.

Blocking Phase 4:

- **D8. Trial for the agent plan.** None, 14 days, or 30 days.
- **D10. Agent price.** $29 stays "proposed". Nothing is created in Stripe until you approve it.

Non-blocking, I will use the default unless you object:

- **D4. One independent workspace per login in v1** (a person can still collaborate on any number of shared deals).
- **D7. Leave the Starter 3-agent-profile cap as is** and describe it as a contact limit.

---

## 13. What I will not do without explicit approval

Change any price, create or modify any Stripe product, change the webhook or checkout, alter `app_metadata.plan` for any existing account, touch trial dates, run a migration against production, delete or rewrite any transaction, or send anything to real customers.

## 14. Recommended next step

Approve Phase 0 and Phase 1, answer D2, D3, D5 and D6, and I start with the characterization tests and the closing of the collaborator gap. That delivers the single most important safety property in your brief (free collaboration is not free independent use) before any new feature exists.
