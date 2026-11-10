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
- Step 8, remaining: integration tests for the runner, the AI wrapper against the real model, and the future routes/UI. DONE (relay-test, 14 tests in `tests/integration/automation-foundation.int.test.ts`): events from the real routes (once, owner-scoped, nothing when the flag is off), replay, Draft queue and approve-once, cross-account refusal, kill switch rechecked at approval, create_task once per key, restricted action refused.
- Kill switch UI/endpoint (the table and the guard check exist; env `AUTOMATION_KILL_SWITCH=1` also works).
- Delivery status audit for sent mail (result is stored on `automation_actions`; real Resend delivery is untested).

**Found while building (not fixed):**
- `automation_settings` is unique per deal only through a partial index, so PostgREST `upsert(..., onConflict)` cannot target it. The future settings route must select-then-insert/update (the integration test does delete + insert).
- The checklist auto-close path in `src/app/api/tasks/route.ts` does not call `notifyDealClosed`, so a deal closed by completing the last step never notifies the broker. Same root cause as the open item in section 3. (An automation `deal_closed` event is now emitted there.)
- Git on this machine had no identity configured; commits in this session used the repo's existing author with `-c user.name/-c user.email`, no config was changed.

### Auto-0 part 2 status (updated 2026-11-09, session 3)

BUILT (committed locally, not pushed):
- Runner `src/lib/automation/tick.ts` + `GET /api/cron/automation-tick` (Bearer CRON_SECRET). Resumes held/retried actions, processes new events, sweeps deals with the assistant on, sends one daily briefing per owner from 7am local. Repeatable: idempotency keys + atomic claims. **D3 resolved:** Vercel Hobby only allows daily crons, so Supabase pg_cron + pg_net calls the route hourly (`add-automation-schedule.sql`, placeholders `<APP_URL>`/`<CRON_SECRET>`, never commit them filled) and `vercel.json` has a daily fallback.
- Executors: create_task, add_note (Activity timeline only), notify_user, suggest_tick, classify_document, file_document, set_date, send_deal_email, send_step_email, send_briefing.
- Stage A rules (no AI) in `rules.ts`: follow-up timers (approved-template step emails, max 5 chases), deadline overdue/soon, closing soon, missing contract, daily briefing.
- Routes under `/api/automation/*` (activity, settings, pause, approvals, actions/[id]/decide), registered in the route registry.
- UI: `AssistantPanel` (Off/Draft/Auto + Activity and approvals) on the deal Overview tab (TC accounts) and listing page.
- `/agent` redirects workspace (paid) agents to `/dashboard`.

SQL: `add-automation-foundation.sql` (run on relay-test), `add-automation-owner-actions.sql` (needed for the briefing; relay-test pending), `add-automation-schedule.sql` (pending). NONE run on production.

PLANNED / known gaps: AI proposals are not wired into the tick (Stage B); listing events are not emitted; checklist auto-close does not call `notifyDealClosed`; a send retry could double-send if the email went out but the DB update failed; no all-deals approvals page or badge yet (the route exists).

### Auto-1: Automation Library, phase 1 (updated 2026-11-09, session 3)

BUILT (committed locally, not pushed). The product model, per the founder: an **Automations** page (last item in the left sidebar, `/dashboard/automations`) where saved workflows are built, split Transaction / Listing. Applying one to a deal or listing creates an independent **copy** (instance) with its own snapshot of the steps; editing the template never changes running copies, "Update them" does that on purpose. Each copy runs through the same guard, approval queue and action log as Auto-0 (Draft = emails wait for approval, Auto = they send).
- SQL: `add-automation-library.sql` (templates, instances, `instance_id`/`step_id` on `automation_actions`). Run `add-automation-owner-actions.sql` too. NOT run anywhere yet when this was written.
- `src/lib/automation/library.ts` (pure: catalog, validation, scheduling rule, recipients, variables), `instances.ts` (database side + `runInstances`, called by the tick), routes `/api/automation/templates[/id[/duplicate|/update-copies]]`, `/instances[/id]`, `/history`.
- Triggers (all real): transaction created, contract uploaded, any document uploaded, transaction closed, acceptance date, closing date; listing created, planned list date, listing expiration date. Steps: send email (by role, only people on the deal), add checklist step, notify me, add note; listing automations can also email and add checklist steps (see Auto-1b below).
- Timing: N days after the trigger, or N days before a date trigger. Steps whose time passed before the copy was applied, or more than 3 days ago, are skipped, never fired late. A moved closing date schedules the steps again (key includes the anchor).
- UI: Automations page (cards, builder, history), "Apply automations" in the new-transaction form and the new-listing form, "Automations on this transaction/listing" block in the deal Automation tab and listing panel. Applying turns the deal's assistant from Off to Draft.
- Turning a template off pauses its copies and cancels queued work; deleting stops its copies; removing a copy cancels its queue.

- **Preset library** (`src/lib/automation/presets.ts`, `PresetLibrary.tsx` at the top of the Automations page): 14 transaction + 5 listing ready-made automations with full email wording, "View workflow and emails", "Customize" (opens the builder prefilled) and "Add as is". Every preset is validated by the same code as a hand-made one (unit test). Deadline triggers read the deal's Critical dates (earnest money, inspection, appraisal, financing, title) and stop once a date is marked done; reminders never mark anything complete. `COMING_SOON` lists wanted presets that need data Relay does not record yet (showings, listing status events, required-document tracking).

- **AI (phase 2 start), BUILT:** `builderCore.ts`/`builder.ts` + `POST /api/automation/ai/draft` and `/ai/email`. Describe an automation in plain English -> a DRAFT that must pass `validateDefinition` (so only catalog triggers/steps/roles/conditions), opens in the normal popup to review and save; unclear parts come back as questions, impossible parts as "unsupported"; never invents recipients or dates. "Write/Rewrite with AI" on email steps (placeholders only, unknown ones stripped). Same monthly token cap and `ai_usage` metering as the rest of automation; model `ANTHROPIC_AUTOMATION_DRAFT_MODEL` (default claude-sonnet-5-5). Tested with a fake client (no real model call has been made).
- **Conditions, BUILT:** optional "only if" on a transaction step: Critical date not marked done, role present/missing, no document like X. Checked when the step is due; a false step is re-checked on later runs until it is too old (3 days).
- **Stalled-deal notice, BUILT:** weekly owner notification listing open deals with nothing recorded for 7 days (for deals with the assistant on). Key `stalled:<owner>:<monday>`.
- NOT built: reading documents for missing signatures, AI seller updates (no showings recorded; `listing_offers` tables exist, so offer triggers are a candidate), brokerage-wide oversight.

PLANNED, not built: natural-language/AI builder, conditions and branches, "run another automation", wait/check steps, update-deal-status and field actions, status-changed / showing / offer triggers (no events exist yet), listing email, listing-to-transaction handoff, team/brokerage-wide templates, a per-deal history view beyond the Activity list, and dedupe of events for listing triggers.

### Then
Stage A (rules only, no AI: follow-up timers, deadline guard, daily briefing, missing documents), Stage B (AI reads, a person confirms), Stage C (drafts with approval), Stage D (opt-in auto-send). Brokerage-wide automation and external integrations come after customer validation.

Financial automation (commission amounts, invoices, payments) only prepares records and asks for approval. Nothing automated moves money.

## 7. How to work in the next chat

1. Read this file, the top DEV_LOG entries and plan sections 16.4 to 16.6.
2. Confirm D3 and D4 with Abdi before writing the runner or sender.
3. Build Auto-0 in small commits, each with tests; run tsc, targeted eslint and related tests before every commit.
4. Add a DEV_LOG entry per session (newest first): commit, what changed, what was verified, what remains.
5. Report BUILT and PLANNED separately, and say plainly what was not verified (browser clicks, real email, production).

### Auto-1b: listing side (BUILT, committed locally, not pushed)

- Listing automations can now **send emails** and **add checklist steps** (`listing_tasks`), as well as notify and note. New trigger **Offer received** (`offer_received`; an event: each new `listing_offers` row after the copy was applied fires the steps once, a second offer fires them again). Steps cannot be "before" an event trigger.
- Who can be emailed on a listing: the listing's agent (agents table, if it has an email) and the listing's saved contacts (`listing_contacts`), nobody else. Contact roles are free text, so `categoryOfRole` (pure, in `library.ts`) maps them to Seller / Buyer / Lender / Title / Inspector / Appraiser / Attorney; "Seller's attorney" is an attorney. `src/lib/automation/listingContext.ts` loads them; the guard's allow-list, the daily cap and the missing-role warning all use it. Same approval rules as deals (Draft waits, Auto sends).
- Listing emails have no deal inbox: they go out under the person's name with Reply-To set to them, and appear in the outbox on a dev machine. `sendDealEmail` takes a null transaction id for this.
- Presets: Listing Preparation Reminders now adds checklist steps; new "Listing Goes Live: Tell the Seller" and "New Offer Received" (never accepts or rejects). The AI builder knows listings can email and add tasks.
- Conditions ("only if") are still deals-only. No new SQL needed.
- Still not built for listings: showing triggers, status-change triggers, offer details in email text (placeholders are still the four known ones), listing-to-transaction handoff.
- Verified: tsc clean, 521 unit tests, 30 integration tests on relay-test (new: an offer arrives -> task added, seller email waits for approval, email to a role nobody holds is refused, a second run does nothing new), and a live Sonnet 5.5 draft for "when an offer comes in, email the seller and add a task".

### Auto-1c: Tracker tab on every deal and listing (BUILT, committed locally, not pushed)

- New **Tracker** tab on transactions and on listings (listings also get their own **Automation** tab now; the panel used to sit inside Overview). Hidden for a brokerage owner looking in, for agents, and when the flag is off.
- Per automation: progress bar, then every step with what it does, when it is due (a real date), and its state: Done, Needs your OK, Held (quiet hours), Not done (with the reason in words), Failed, Cancelled, Scheduled, Due now, Held back ("only if" is false), Skipped (too old or before the copy was added), Waiting to start (the date/event does not exist yet).
- Actions: **Run now** / **Run again** on any step, **Run what is left now** (skips what is done or waiting for approval), Approve/Reject a draft in place, Pause/Resume a copy (pausing cancels what it had queued), Remove, **Add an automation** (any saved one not yet on the file), turn the assistant on from the banner when it is Off.
- Manual runs ignore the schedule and the "only if" but NOT the guard (mode, allowed recipients, daily cap, Draft approval). A manual run uses key `inst:<id>:<step>:manual:<ms>`; a second click within 15 s is refused as `already_running`. Manual runs show as "run by you".
- Code: `stepProgress` (pure, library.ts, unit-tested), `progressFor` / `runNow` / `setInstanceStatus` (instances.ts), routes `GET /api/automation/progress`, `POST /api/automation/instances/[id]/run`, `PATCH /api/automation/instances/[id]`; `src/components/AutomationTracker.tsx`.
- Verified: tsc, 530 unit tests, 31 integration tests on relay-test (new: progress states, run once, double click, pause blocks run, resume, run what is left, other account gets 404). Not verified in a browser.
- Not built: edit-before-approve inside the Tracker (use the Automation tab), a cross-deal overview, notifications when a step fails.

### Auto-1d: banners and the Tracker count (BUILT, committed locally, not pushed)

- What needs approval: only emails (Draft mode) plus the always-approve kinds (contract dates, suggestions, document filing). Notifications, checklist steps and notes just happen. Unchanged; confirmed against the user's own Verify Agent test.
- **Banners** above the tabs of every deal and listing (`AutomationAlerts.tsx`, `src/lib/automation/alerts.ts`, pure `alertCore.ts`): a draft email waiting ("Needs your OK": Approve / Review), a reminder an automation raised (from `notify_me` steps, so "N days before X" reminders show up on the day), and an email that did not go ("Did not go", with the reason). Reminders and problems stay until **Got it** (or "Got it for all"); drafts leave when decided; removing an automation removes its banners. Shows 3, "N more in the Tracker".
- Whole-account refusals (assistant Off, paused, no plan) do not make a banner per step; the Tracker's Off banner covers them.
- **Count on the Tracker tab** (amber number) = banners open. Refreshes on focus, every 60 s while visible, and instantly after anything is changed in the Tracker or Automation tab (`relay:automation-changed` event).
- Acknowledged is stored inside the action's `result` (`acknowledgedAt`); no SQL needed. Reminders still also go to the Relay bell as before; acknowledging a banner does not mark the bell item read (not built).
- Banners are not shown to a brokerage owner looking in, or to agents.
- Verified: tsc, 538 unit, 32 integration tests on relay-test. Not verified in a browser.

### Auto-1e: owner-only tabs; quick create and edit on a file (BUILT, committed locally, not pushed)

- **Owner-only.** The Automation and Tracker tabs and the banners show only to the account that owns the deal or listing. The server decides: `GET /api/transactions` adds `canAutomate` (`!isAdmin && tc_user_id === user.id`) and `GET /api/listings/[id]` adds `canAutomate` (`!isAdmin && !shared && !coordinated && tc_user_id === user.id`). Not shown to a coordinator or agent a file is shared with, a teammate, a brokerage owner looking in, or an admin. The API already refused all of them (404); the screen now matches.
- **Quick create on a file** (`QuickAutomation.tsx`; "Create new" in the Tracker, "New automation here" in the Automation tab): describe it in plain English (the AI draft, type already fixed) or build it by hand, review, then it is added to this file as soon as it is saved. Checkbox "Also save it to my library" (on by default); off = a file-only automation (`template_id` null, via `POST /api/automation/instances { definition }`).
- **Edit on a file** ("Edit" on each automation, in the Tracker and the Automation tab): changes this file's copy only (`PATCH /api/automation/instances/[id] { definition }`). When it starts (the trigger) and its type are locked, because a different start date would make steps that already ran look new. Steps that already ran are never run again; removed steps lose anything they had queued; new steps get ids never used before on that copy (`reservedIds`), so a removed step's id cannot be reused. Optional checkbox "Also update the version in my library" (other files keep their copy until Update copies).
- Test-suite fix: integration tests now switch quiet hours off so they do not depend on the time of day (the default 9pm-7am Central holds emails as `deferred`, which is correct product behaviour).
- Verified: tsc, 538 unit, 33 integration tests on relay-test. Not verified in a browser.

### Auto-1f: approvals now (popup), no night-time holding, one Automation tab (BUILT, committed locally, not pushed)

- **Why emails were "held":** the guard checked quiet hours (default 9pm-7am, America/Chicago, per file) BEFORE asking for approval, so a draft made at night waited until 7am before it even asked. Fixed in `guard.ts`: quiet hours now hold only a send that would go out with nobody deciding (Auto mode + approved template). Asking the owner (Draft) is never held, and an email the owner just approved goes immediately (`approvedByPerson`; the other rules, strangers and the daily cap, still apply). Drafts already held are put to the owner at the next hourly check.
- **Immediate:** adding an automation to a file, editing/resuming one, a deal event (`emitDealEvent`: contract/document/closed) and a new listing offer now run that file's automations at once (`runInstancesFor`), so the approval popup appears right away instead of at the next hourly check. The hourly check remains the safety net.
- **Approval popup** (`ApprovalPopup.tsx`, mounted in the dashboard layout, so it shows wherever you are): the email's To / Subject / message, with Approve and send, Edit (change the text, then Save and send), Reject, or Later (hidden for this visit only). Polls every 30 s, on window focus and on `relay:automation-changed`. Uses `GET /api/automation/approvals` (now includes listings).
- **One Automation tab** on deals and listings (`AutomationTab.tsx`): Tracker first, "Settings & activity" (mode, switches, activity list) second; the open-items count sits on the tab. Old `#tracker` links open it.
- Verified: tsc, 542 unit, 34 integration tests (new: a draft appears on apply, in quiet hours, approving sends now). Not verified in a browser.
- Not built: a global approvals page; editing quiet hours in the UI (the settings route accepts them).

### Auto-1g: test-mode honesty (BUILT, committed locally, not pushed)

- On a developer machine `RELAY_OUTBOX_ONLY=1` (and `check-local-env.mjs` refuses a real Resend key), so an approved or automatic email is recorded in `email_outbox` (`result.mode = 'outbox'`) and goes to no one. The Tracker used to say just "Done". Now: a prominent amber test-environment banner; each sent email shows "Saved to the test outbox (not sent)" (or "Sent to ...") with **View email** (To, subject, body, from the action's inputs); the approval popup says approving saves to the outbox. Nothing about real sending changed: production (no `RELAY_OUTBOX_ONLY`) sends through Resend.

