# Release runbook: TC launch (templates, other invoices, archive, email log, automation)

Scope: ship to TCs first. Agent workspace and brokerage code ships **dark** (flags off, no menu entries, APIs answer 404). Announce paid agent and brokerage tiers and rewrite the website later.

BUILT vs PLANNED is kept separate below. Nothing here has been run against production. Nothing is pushed on the preview branch.

## What is in this release (BUILT)
| Feature | Flag | Who sees it |
|---|---|---|
| Templates (state-filtered documents and emails) | `templates` | every TC plan |
| Other invoices + agent fee picker + listing invoices | `other_invoices` | every TC plan |
| Archive deals | none (always on) | every TC |
| Step "Email" buttons: logged to a per-deal email log, duplicate-send protection | none | every TC |
| Large file uploads (up to 25 MB) | none | **already live** (PR #11) |
| Automations tab (templates, per-deal instances, task triggers, Draft/Auto, approvals) | `automation` | **Pro and Team only** (also needs the flag) |
| Agent workspace, brokerage oversight | `agent_workspace`, `brokerage` | nobody (stay OFF) |

PLANNED, not built: listing automations (Phase 4), all-deals action queue + library rewrite + history (Phase 5), brokerage templates, quiet-hours UI, AI seller updates.

## Step 0. Before anything (you)
1. Supabase, production project: take a backup (Dashboard > Database > Backups, or a manual export). Note the time.
2. Open the SQL editor on **production** (not relay-test). Check the project name before every run.

## Step 1. Read-only check (you, 1 minute)
Run `docs/release/00-check-production.sql`. It changes nothing. It lists 49 tables/columns the new code needs. Expect many `present = false` (production's last schema snapshot, 2026-11-02, had none of them). Paste me any surprising result: if something is already `true`, someone ran a file there and I will adjust.

## Step 2. Migration (you)
Run `docs/release/01-migrations-all.sql` once. It is one transaction: all or nothing.
- Rehearsed on a scratch copy of production's schema snapshot: 26 files apply with 0 errors, 30 new tables and 19 new columns, and a second run changes nothing.
- Existing data touched: `remove-starter-letters.sql` archives two old starter letter templates (archived, not deleted); `add-listing-invoices.sql` makes `invoices.transaction_id` optional (so listing invoices can exist). Nothing is dropped.
- NOT in it: `add-automation-schedule.sql` (see Step 6).
Then run `00-check-production.sql` again: expect **zero** rows with `present = false`.
If the script errors: nothing was applied; send me the error text.
Why before the code: the new code reads the new columns even with the features off.

## Step 3. Ship the code, everything still OFF
Branch `preview/agent-invoices-and-stripe` is ~165 commits ahead of `main`. Do not merge blind.
1. Open a PR from it into `main` and let Vercel build the preview.
2. On the preview/production, with **no** `RELAY_FEATURES` set, check: sign in, dashboard, an existing deal and its documents, Invoices, Contacts, Calendar, Messages, an agent portal login, and a large-PDF upload. Nothing new should be visible except Archive and the email log.
3. Merge. Wait for **Ready** + **Production** in Vercel.
Rollback: Vercel > Deployments > previous deployment > Promote to Production (database additions can stay; they are additive).

## Step 4. Turn on templates + other invoices
Vercel > Settings > Environment Variables (Production): set both
`RELAY_FEATURES=templates,other_invoices` and `NEXT_PUBLIC_RELAY_FEATURES=templates,other_invoices`, then **Redeploy** (the NEXT_PUBLIC copy is baked in at build time).
Check as a Starter account and as a Pro account: Templates tab present, Invoices > Other invoices works, a template applies to a deal.

## Step 5. Automation: pilot, Draft mode, Pro/Team only
Cost and safety controls (all exist):
- Default model for in-engine AI is Haiku (`ANTHROPIC_AUTOMATION_MODEL`). The Sonnet model (`ANTHROPIC_AUTOMATION_DRAFT_MODEL`) is used only when someone uses the "describe it" builder.
- Monthly token cap per account: `AUTOMATION_MONTHLY_TOKEN_CAP` (default 500,000).
- Kill switch: `AUTOMATION_KILL_SWITCH=1` stops everything (needs a redeploy), or pause one account from the admin controls.
- Most of the engine is rules (dates, steps, templated emails), not AI. Measure real token use during the pilot before deciding more.
Required env: `CRON_SECRET`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY` already in production. Confirm `CRON_SECRET` is set.
Enable: add `automation` to both flag lists, redeploy. The Automations tab then shows for Pro/Team accounts only. Pilot with one or two TCs (Pam is Pro) in Draft mode (nothing sends without approval). Watch Vercel logs and `deal_email_log`.

## Step 6. Hourly schedule (only when the automation flag goes on)
Vercel is on the Hobby plan: Vercel crons run once a day. Task-based triggers (tick a step, receive a document) fire immediately; time-based ones (follow-ups, reminders) need the hourly run.
1. Supabase > Database > Extensions: enable `pg_cron` and `pg_net`.
2. Copy `add-automation-schedule.sql`, replace `<APP_URL>` with `https://www.relaytc.com` and `<CRON_SECRET>` with the Vercel value. **Never commit the filled-in file.** Run it on production.
3. Confirm the last query shows job `relay-automation-tick` active.
Also decide: Vercel Hobby is intended for non-commercial use; upgrade to Pro before relying on this commercially.

## Step 7. Announce to TCs, update the website for TCs
Pricing/features: Starter vs Pro vs Team now include Templates (all), Other invoices (all), Archive (all), Automation (Pro/Team). FAQ upload limit "25 MB" is now accurate.

## Later (PLANNED): agent and brokerage launch
Turn on `agent_workspace` / `brokerage`, review Stripe plans and prices (needs your approval: no Stripe change has been made), rewrite the website for the wider scope. Their tables are already in the database after Step 2.

## Not yet verified (be honest)
- No browser click-through of the automation builder, the step Email buttons, archive, or the invoice screens (tests cover logic and the database only).
- Production may have changed since the 2026-11-02 snapshot; Step 1 is what catches that.
- Real-world automation usefulness and token cost are unmeasured; that is the pilot's job.
