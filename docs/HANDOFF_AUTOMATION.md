# Relay TC: handoff to the automation build

Written 2026-11-09. Branch `preview/agent-invoices-and-stripe`. Nothing is pushed; Abdi pushes after all features are done.

## 0. How to start the next chat

Paste this as the first message:

> Read `docs/HANDOFF_AUTOMATION.md`, `docs/DEV_LOG.md` (top 3 entries) and section 16 of `docs/RELAY_IMPLEMENTATION_PLAN.md`. Then continue Auto-0 behind the existing `automation` flag. Inspect the code before changing anything, keep BUILT and PLANNED separate, commit locally, never push. Ask me before any Stripe or production change.

Working agreements: direct, critical feedback; inspect code first; Abdi pushes; agent, brokerage and template features are OFF in production behind flags; localhost uses the relay-test Supabase project (`bmuaxlcaqqifybgheqiq`); production project ref starts `vjfttw` and is never written to from a dev machine.

## 1. State of the product (BUILT, committed locally)

- **TC side**: transactions, checklists, templates, client portal, calendar sync, invoices, team reports, admin Activity tab.
- **Agent workspace**: full workspace for granted agents, shared deals both directions, agent custom invoices (`workspace_invoices`).
- **Listing-fee invoices** visible on the agent side (agent portal, workspace Invoices tab, listing Overview card); banner when a coordinator adds an agent to a listing.
- **Commission (brokerage)**:
  - Two boxes on an agent's deal: Commission first (review and send), Invoices second.
  - Works on coordinator-run deals the agent was added to (`commissionAgentForDeal` in `src/lib/commissions.ts`). Commission-only: the brokerage still cannot see the deal.
  - Broker home has a separate red bubble listing closed deals that need the actual commission confirmed. Each row opens that agent's page, where the confirm form is open (highlighted `$` amount prefilled from the estimate; rate, split and fees behind "Adjust").
  - Broker's view of an agent's listing has no Messages card, only a "Message the agent" button.
- **Verified at HEAD**: `tsc` clean, 400 unit tests pass, commission and brokerage integration tests pass on relay-test. Browser clicks were not verified.

## 2. Things Abdi still has to do (not code)

1. Run `add-listing-agent-notice.sql` on relay-test and on prod, then rerun the skipped banner tests (`agent-listing-notice.int.test.ts`). Without it the banner falls back to a 14-day, browser-only notice.
2. Before pushing: keep the `agent_workspace`, `automation`, `templates`, `brokerage` flags OFF in Vercel production; browser walkthrough of TC, agent and broker; one real Resend send from staging (SPF/DKIM); check `calendarSync.ts` and `dueDateReminders.ts` for ignored Resend errors; post-deploy checks.
3. Decisions D1 to D7 in plan section 16.7. Needed first: **D3** (does the Vercel plan allow an hourly cron? if not, Supabase scheduled functions) and **D4** (send from Relay with the user's display name, Reply-To the deal address).
4. Agent billing (Phase 4) is NOT built. It needs his price (proposed $29) and explicit approval before any Stripe work.

## 3. Open items found, not done

- Broker is not notified when a coordinator-run deal closes (`notifyDealClosed` in `src/lib/dealClosed.ts` keys on the deal owner). Add it commission-only, not by widening `canOverseeDeal`.
- The commissions list on an agent's page links each row to `/dashboard/collaborate/deals/<id>`, which a broker cannot open for coordinator-run deals.
- Pre-existing lint errors in `ListingDetail.tsx` (two set-state-in-effect errors, one unused variable).

## 4. Local setup (localhost)

The code is already in the repo folder, so a running dev server hot-reloads. After a gap:

    cd /Users/abdiaziz/keystone
    npm run dev:local          # port 3000, relay-test data
    npm run dev:prod-readonly  # port 3001, live data, every write blocked

Demo logins (relay-test, password `LocalRelay-2026!`): tc@local.relay, tc2@local.relay, agent-free@local.relay, agent-workspace@local.relay (in broker@local.relay's brokerage), broker@local.relay, admin@local.relay. His own TC test account: aabdiaziz47@gmail.com. Reseed with `node scripts/seed-local.mjs`.

Tests:
- Unit: `env -u RELAY_FEATURES -u NEXT_PUBLIC_RELAY_FEATURES -u RELAY_OUTBOX_ONLY npx vitest run`
- Integration: `set -a; . ./.env.test; set +a; RELAY_OUTBOX_ONLY=1 RELAY_FEATURES=agent_workspace,automation,templates,brokerage NEXT_PUBLIC_RELAY_FEATURES=agent_workspace,automation,templates,brokerage CRON_SECRET=x npx vitest run --config vitest.integration.config.ts <files>`
- Keep each command under about 170 seconds; run tsc, lint and tests separately.

## 5. Conventions that will bite you

- `tests/route-registry.ts` must list every API route. Writing routes call `assertNotCollaborator`.
- Service-role Supabase client everywhere, so authorization lives in app code (`authorize.ts`, `entitlements.ts`). RLS is not the safety net.
- Commissions assume the agent is the deal owner; the participant path goes through `commissionAgentForDeal`. Do not widen `canOverseeDeal` (privacy).
- Feature flags: `RELAY_FEATURES` / `NEXT_PUBLIC_RELAY_FEATURES`. The `automation` flag already exists in `src/lib/features.ts` (deployment switch, off in production). The `automation` entry in `tiers.ts` is a different thing: the per-plan entitlement for template rules. Auto-0 checks both (the flag, then the owner's entitlement in `loadGuardContext`). Gate routes, UI and cron on the flag.
- Every new table needs a SQL file at the repo root, run on relay-test first, then prod before its flag turns on (`docs/PROD_SCHEMA_RECONCILIATION.md`).

## 6. The automation plan, in order

Source of truth for sequencing: `docs/RELAY_IMPLEMENTATION_PLAN.md` section 16 (Roadmap v3). The uploaded "Full Automation Product Plan" is the broader vision; anything in it that is not in section 16 is PLANNED, not committed. Two differences to settle with Abdi first:

- Section 16.1 dropped the natural-language workflow builder; a later section (around line 848) brought a builder back as a chain of steps on top of Auto-0. The vision plan wants a trigger / condition / action / delay / branch builder with AI creation. Build Auto-0 and Stage A first; the builder comes after, on the same foundation.
- The vision plan's table names (`automation_workflows`, `automation_runs`, ...) differ from section 16.4 (`transaction_events`, `automation_settings`, `automation_actions`, `automation_approvals`). Use 16.4 for Auto-0; add workflow tables only when the builder starts.

### Auto-0 (start here, behind the `automation` flag)

1. Migration SQL: `transaction_events`, `automation_settings`, `automation_actions` (with idempotency key), `automation_approvals`, plus a per-account kill switch.
2. `src/lib/automation/guard.ts`: recipient allowlist (must be on the deal), send caps, quiet hours, kill switch, restricted-action list, entitlement check. Everything that sends or writes goes through it. Recheck permissions at execution time; never trust saved config.
3. Event emitters at existing write points (contract uploaded, document added, step ticked, date changed, deal closed) writing to `transaction_events`.
4. Runner: `/api/cron/automation-tick` (hourly, per D3) plus event handlers. Atomic job claims, retries with backoff, replay-safe.
5. Action functions shared by the manual buttons and the assistant (create task, set date, send step email, file document).
6. `src/lib/automation/ai.ts`: one Claude wrapper with strict output schemas, usage log, monthly caps, and a fake for tests. Inbound email text is untrusted data and can never instruct the assistant.
7. Activity and Approvals panel on deals and listings; Assistant setting Off / Draft / Auto per deal.
8. Tests: cross-account isolation, fake clock, fake Claude, prompt injection, idempotency (replay sends nothing twice), guard refusals, route registry.

Done when: a replayed event or cron tick sends nothing twice, the kill switch stops everything, and no user can see or trigger another account's automation.

### Auto-0 status (updated 2026-11-09, session 2)

**BUILT (committed locally, unit-tested, not run against any database):**
- Step 1, migration: `add-automation-foundation.sql` (`transaction_events`, `automation_settings`, `automation_account_controls`, `automation_actions` with unique idempotency key, `automation_approvals`). **Not run on relay-test or prod.** Run on relay-test first; prod needs the founder's approval before the flag is ever on there.
- Step 2, guard: `src/lib/automation/guard.ts` (pure `evaluateGuard`) and `types.ts`. Order: feature, kill switch, entitlement, restricted list, unknown action, mode, recipient allowlist, daily cap, quiet hours, approval rules. No settings row = Off; a new row defaults to Draft.
- Step 3, events: `eventCore.ts` (pure) and `events.ts` (Supabase). Inert unless the flag is on; never fails the request. Wired at: deal PATCH (`deal_closed`, `date_changed`), documents POST (`document_added`, `contract_uploaded` for a Purchase Contract), task toggle (`step_ticked`, and `deal_closed` when the checklist auto-closes the deal).
- Step 5 (partly), actions: `actionCore.ts` (pure `submitAction` / `approveAction`, replay-safe, rechecks the guard at approval) and `actions.ts` (Supabase store, `loadGuardContext`, executors for `create_task` and `send_deal_email` via `sendDealEmail`, D4). Recipients are read from the same `inputs.to` that is sent.
- Step 6, AI wrapper: `aiCore.ts` (strict proposal catalog, untrusted-text fence, monthly token cap, `FakeAiClient`) and `ai.ts` (Claude tool-call client, usage via `ai_usage` feature `automation`). Default model `claude-haiku-5-5`, overridable with `ANTHROPIC_AUTOMATION_MODEL`; cap default 500k tokens/month is a placeholder until D6.

**PLANNED / NOT built yet:**
- Step 4, runner: `/api/cron/automation-tick`. **Blocked on D3** (the answer came back garbled; ask again). Also needs atomic claims and backoff, which the schema supports (`claimed_at`, `next_attempt_at`, `attempts`).
- Step 5, remaining executors (`add_note`, `suggest_tick`, `classify_document`, `file_document`, `set_date`, `send_step_email`, `notify_user`): the manual routes still hold their own logic; extract it into shared functions first. These actions currently end as `failed: not_implemented`.
- Step 7, Activity and Approvals panel, the Off / Draft / Auto setting UI, and the API routes behind them (new routes must be added to `tests/route-registry.ts`).
- Step 8, partly: cross-account isolation and DB-backed idempotency integration tests need the migration run on relay-test first. Unit tests cover the fake clock, fake Claude, prompt injection, replay, guard refusals.
- Kill switch UI/endpoint (the table and the guard check exist; env `AUTOMATION_KILL_SWITCH=1` also works).
- Delivery status audit for sent mail (result is stored on `automation_actions`; real Resend delivery is untested).

**Found while building (not fixed):**
- The checklist auto-close path in `src/app/api/tasks/route.ts` does not call `notifyDealClosed`, so a deal closed by completing the last step never notifies the broker. Same root cause as the open item in section 3. (An automation `deal_closed` event is now emitted there.)
- Git on this machine had no identity configured; commits in this session used the repo's existing author with `-c user.name/-c user.email`, no config was changed.

### Then
Stage A (rules only, no AI: follow-up timers, deadline guard, daily briefing, missing documents), Stage B (AI reads, a person confirms), Stage C (drafts with approval), Stage D (opt-in auto-send). Brokerage-wide automation and external integrations come after customer validation.

Financial automation (commission amounts, invoices, payments) only prepares records and asks for approval. Nothing automated moves money.

## 7. How to work in the next chat

1. Read this file, the top DEV_LOG entries and plan sections 16.4 to 16.6.
2. Confirm D3 and D4 with Abdi before writing the runner or sender.
3. Build Auto-0 in small commits, each with tests; run tsc, targeted eslint and related tests before every commit.
4. Add a DEV_LOG entry per session (newest first): commit, what changed, what was verified, what remains.
5. Report BUILT and PLANNED separately, and say plainly what was not verified (browser clicks, real email, production).
