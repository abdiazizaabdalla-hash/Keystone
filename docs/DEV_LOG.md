# Relay TC development log

Newest first. One entry per working session: commit, what changed, what was verified, what remains.

## 2026-11-06 - invitation emails no longer fail silently

- **Problem.** All ten senders in `src/lib/agentPortalEmails.ts` ignored Resend's `{ data, error }` result, so a refused send was reported as "Invitation sent" (live site included). On a developer machine the key is fake on purpose, so invitations vanished with no way to see them.
- **Change.** One checked path, `deliverEmail`. A refused or failed send now throws `EmailDeliveryError` (every existing caller already handles a thrown email error). With `RELAY_OUTBOX_ONLY=1` nothing is sent: the email is recorded in `email_outbox` under the sender and shows in the existing test outbox (`/api/template-runs/outbox`). Invite flows return `email_failed`; the invitation stays saved and can be resent; the add-coordinator dialog and listing invite say the email did not go out.
- **Verified.** `tsc --noEmit` clean, eslint clean on changed files, 19 unit files / 361 tests pass (9 new in `tests/agentPortalEmails.test.ts`; re-introducing the bug makes them fail).
- **Not run here.** Integration suite (`invite-both-ways`): run it on the Mac with `RELAY_FEATURES=agent_workspace,automation,templates,brokerage RELAY_OUTBOX_ONLY=1 CRON_SECRET=x npx vitest run --config vitest.integration.config.ts tests/integration/invite-both-ways.int.test.ts`.
- **Remaining.** Real delivery must be tried once from a staging environment with a real Resend key and a verified sending domain (SPF/DKIM) before launch. `calendarSync.ts` and `dueDateReminders.ts` were not checked for the same ignored-error pattern.
