# Relay TC development log

Newest first. One entry per working session: commit, what changed, what was verified, what remains.

## 2026-11-09 (session 3b) - Automation Library, phase 1

- BUILT: Automations page + builder, saved templates, per-deal copies, Apply automations in transaction and listing setup, engine step in the runner, history, routes (registered), sidebar entry. Founder decisions: sidebar placement, phase 1 only, keep the per-deal Assistant tab. See HANDOFF "Auto-1".
- Verified: tsc clean, 492 unit tests (22 new for validation and scheduling). Integration test written (`automation-library.int.test.ts`) but NOT run: relay-test lacks the new tables until `add-automation-library.sql` is run. Not verified: browser clicks.
- Not built: AI builder, branching, org templates, more triggers (see HANDOFF). Nothing pushed.

## 2026-11-09 (session 3) - Auto-0: runner, screens, Stage A rules

- BUILT: runner + cron route (hourly via Supabase pg_cron, daily Vercel fallback; D3 resolved), remaining executors, Stage A rules, five `/api/automation/*` routes, AssistantPanel on deal and listing pages, `/agent` redirect for paid agents. Two new SQL files (owner-actions, schedule), unrun anywhere.
- Verified: tsc clean, eslint clean (pre-existing `<img>` warnings only), 463 unit tests, 21 automation integration tests on relay-test. Not verified: browser clicks, briefing end to end (needs owner-actions SQL), real Resend, production.
- Not built: AI in the tick, listing events, approvals page. Nothing pushed.

## 2026-11-09 (session 2) - Auto-0 started behind the existing `automation` flag

- BUILT: migration SQL (unrun), guard, event log with emitters at the deal PATCH, documents POST and task toggle, action pipeline with idempotency and approval rechecks, AI wrapper with a strict proposal catalog and a fake. See `docs/HANDOFF_AUTOMATION.md` "Auto-0 status".
- Decisions: reuse the existing `automation` flag (the `tiers.ts` entry is a separate entitlement, now commented); D4 confirmed (send from Relay under the user's name, Reply-To the deal address; outbox-only locally). D3 still open: no runner written.
- Verified: `tsc` clean, eslint clean on changed files, 441 unit tests pass (41 new). Migration run on relay-test only (production untouched, checked read-only). 14 new integration tests pass on relay-test through the real routes; deal-closed-notify, cross-account and collaborator-routes still pass (74 tests). Not verified: browser clicks, real Resend delivery, real Claude calls, production.
- Not built: runner (D3), remaining executors, Activity and Approvals UI, routes, integration tests. Nothing pushed.

## 2026-11-09 - commission flows finished, handoff to automation

- Listing-fee invoices visible to agents (portal, workspace Invoices, listing Overview) with a banner when a coordinator adds them; Generate invoice stays on the listing/deal as a popup.
- Commission: its own box first, Invoices second; works for agents added to a coordinator's deal (`commissionAgentForDeal`); brokerage confirm step with a highlighted `$` amount; broker home bubble listing closed deals to sign off, linking to the agent's page; broker listing view has a Message the agent button instead of the thread.
- Verified: tsc, 400 unit tests, commission and brokerage integration tests on relay-test. Not verified: browser clicks.
- Remaining: run `add-listing-agent-notice.sql` (relay-test, prod); broker notice when a coordinator-run deal closes. Next: Auto-0, see `docs/HANDOFF_AUTOMATION.md`.

## 2026-11-08 - closing out the pre-automation gaps

- **Team reports** (owner-only Excel workbook, weekly/monthly schedule, saved snapshots, notes), **admin Activity tab and full account profile**, `npm run dev:prod-readonly` (live data, every write blocked, port 3001).
- **Shared deals** now appear in the Needs Attention panel and the in-app calendar for a paid or in-trial coordinator; a coordinator whose trial ended sees them in their list as view-only (agent logins keep using the /agent portal).
- **Brokerage document files.** The owner's deal and listing pages already opened document files; the terms did not say so. Terms now say it, and each agent controls it (`brokerage_links.can_open_documents`, default on, `add-brokerage-permissions.sql`). Off = names only. Opening files is audit-logged (`brokerage.documents_opened`).
- **Production schema check (read-only, 2026-11-08):** prod lacks 20 tables and `agents.services`, `transactions.property_state`; all come from SQL files for the flagged features (order listed in the handoff). Run them before any flag is turned on.
- **Not built:** agent billing (Phase 4) needs a price and approval.
- **Verified:** tsc, 399 unit tests, full integration suite in chunks, `next build`. Permission toggle tests skip until `add-brokerage-permissions.sql` is run in relay-test (also `add-team-reports.sql`).

## 2026-11-06 - invitation emails no longer fail silently

- **Problem.** All ten senders in `src/lib/agentPortalEmails.ts` ignored Resend's `{ data, error }` result, so a refused send was reported as "Invitation sent" (live site included). On a developer machine the key is fake on purpose, so invitations vanished with no way to see them.
- **Change.** One checked path, `deliverEmail`. A refused or failed send now throws `EmailDeliveryError` (every existing caller already handles a thrown email error). With `RELAY_OUTBOX_ONLY=1` nothing is sent: the email is recorded in `email_outbox` under the sender and shows in the existing test outbox (`/api/template-runs/outbox`). Invite flows return `email_failed`; the invitation stays saved and can be resent; the add-coordinator dialog and listing invite say the email did not go out.
- **Verified.** `tsc --noEmit` clean, eslint clean on changed files, 19 unit files / 361 tests pass (9 new in `tests/agentPortalEmails.test.ts`; re-introducing the bug makes them fail).
- **Not run here.** Integration suite (`invite-both-ways`): run it on the Mac with `RELAY_FEATURES=agent_workspace,automation,templates,brokerage RELAY_OUTBOX_ONLY=1 CRON_SECRET=x npx vitest run --config vitest.integration.config.ts tests/integration/invite-both-ways.int.test.ts`.
- **Remaining.** Real delivery must be tried once from a staging environment with a real Resend key and a verified sending domain (SPF/DKIM) before launch. `calendarSync.ts` and `dueDateReminders.ts` were not checked for the same ignored-error pattern.
