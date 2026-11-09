# Relay TC development log

Newest first. One entry per working session: commit, what changed, what was verified, what remains.

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
