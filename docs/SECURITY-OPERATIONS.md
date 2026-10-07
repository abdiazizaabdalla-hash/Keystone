# Relay TC security operations

What the code can't do for itself: settings to check, routines to follow, and what to do when something goes wrong. Keep this file current.

## 1. One-time setup checklist

### Run once, in order
1. `lock-down-database-access.sql` (Supabase SQL Editor) — closes every table to the public key.
2. `add-audit-log.sql` — creates the audit trail table (the app logs quietly until it exists).
3. `node scripts/migrate-privileged-metadata.mjs` → `--apply` → push → `--scrub` (already done if you followed the earlier steps).

### Supabase dashboard
- **Authentication → Providers → Email:** require email confirmation; minimum password length 10+; turn on leaked-password protection (HaveIBeenPwned) if offered.
- **Authentication → Multi-Factor:** TOTP must be enabled (it is by default) for the Account page's two-step sign-in to work.
- **Authentication → URL configuration:** Site URL = `https://www.relaytc.com`; list only your real redirect URLs.
- **Authentication → Rate limits / CAPTCHA:** enable CAPTCHA (Turnstile or hCaptcha) on sign-up, sign-in, and password reset once you have traffic.
- **Database → Backups:** confirm daily backups are on. On the Pro plan, enable Point-in-Time Recovery once you hold customer files you can't recreate.
- **Storage:** `transaction-documents` bucket must stay **private**.

### Accounts (turn on two-factor on every one)
GitHub, Vercel, Supabase, Stripe, Resend, Sentry, Anthropic, your domain registrar / DNS host, and the email account that receives resets for all of them.

### Email authenticity (Resend → Domains)
Add the SPF, DKIM and DMARC records Resend lists for your sending domain, wait until the domain shows **Verified**, then publish a DMARC record, e.g. `_dmarc  TXT  "v=DMARC1; p=none; rua=mailto:you@yourdomain"` and tighten to `quarantine` after a few clean weeks. Without these, invoices and signing emails land in spam and your domain can be spoofed.

### GitHub
Settings → Code security: enable **Dependabot alerts**, **Dependabot security updates**, **Secret scanning** and **Push protection**. (`.github/dependabot.yml` already schedules weekly dependency PRs.)

### Sentry
Create alert rules: (a) any new issue in production, (b) error rate spike, (c) more than N events from `auth/*` routes in 10 minutes. Send them to email/phone.

## 2. Content-Security-Policy rollout
`next.config.ts` ships the policy in **report-only** mode (nothing is blocked). To enforce:
1. Open the live site with the browser console open and click through: sign in, dashboard, a transaction (upload, preview a PDF, open messages), invoices, signing page, pricing/FAQ.
2. If the console shows "Content Security Policy" violations, add the missing host to the matching directive in `next.config.ts`, deploy, repeat.
3. When a full pass is clean, set `CSP_MODE=enforce` in Vercel env and redeploy.

## 3. Secrets
- `SUPABASE_SERVICE_ROLE_KEY` bypasses all access rules. It lives only in Vercel env and your local `.env.local`. Never put it in client code, screenshots, chats, tickets or commits.
- **Rotate immediately** (Supabase → Settings → API; then update Vercel and redeploy) if it may have been exposed. Rotate Stripe keys, webhook secrets, `RESEND_API_KEY`, `CRON_SECRET` the same way.
- Quarterly: rotate `CRON_SECRET`; review who has access to Vercel/Supabase/Stripe.

## 4. Data requests and retention
- **Export:** customers self-serve at Account → Your data → Download my data (JSON).
- **Deletion:** Account → Request deletion records the request, emails the operator, and confirms to the customer. **Complete within 30 days:**
  1. Cancel their Stripe subscription (and Connect account if they connected one).
  2. If they own a team, move or remove the members first.
  3. Delete their rows (agents, transactions and everything keyed to them, documents + storage objects, templates), then the auth user in Supabase → Authentication.
  4. Email them confirmation. Record it (the `audit_log` keeps who/when).
- **Automatic retention:** `/api/cron/cleanup` (daily) deletes temporary `invoice-exports/*.zip` older than 14 days. Review other retention needs annually.
- **Audit log:** `audit_log` table. Query it for who signed in, deleted, downloaded, invoiced, or changed team access. Keep at least 12 months.

## 5. Backups and recovery
- Supabase daily backups (database). Storage files are **not** in the database backup — if documents matter, periodically copy the bucket elsewhere.
- Test a restore once per quarter into a scratch project; write down the steps and how long it took.

## 6. Incident response
**Suspected breach, leaked key, or abuse:**
1. **Contain (first hour):** rotate the exposed secret(s) (section 3); in Supabase Auth you can sign out all users / revoke sessions; suspend an abusive account from Admin → Users; disable a compromised integration key.
2. **Assess:** use `audit_log`, Vercel logs and Sentry to find what was accessed, by whom, from where, and when it started. Preserve logs (export them) before they roll off.
3. **Fix:** patch the cause, deploy, and re-run the live checks (anonymous database probe, unauthenticated API calls return 401).
4. **Notify:** if personal information of customers or their clients was exposed, notify affected customers promptly and as required by applicable state breach-notification laws (many require notice within 30–60 days; some sooner) and, where required, regulators. Talk to a lawyer before sending.
5. **Review:** write a short post-mortem (what happened, impact, fix, what changes) and update this document.

Security reports from outside: `/.well-known/security.txt` lists the contact. Acknowledge within 2 business days.

## 7. Release hygiene
- Before each release: `npx tsc --noEmit`, `npm run build`, `npm audit --omit=dev`.
- Never commit `.env*` files; GitHub secret scanning + push protection back this up.
- New table in Supabase? Enable RLS and grant nothing to `anon`/`authenticated` (see `lock-down-database-access.sql`, which also sets default privileges).

## 8. Known remaining work
- **Session storage:** sign-in tokens live in the browser's `localStorage`. Moving to `HttpOnly` cookies removes the biggest XSS-theft risk but touches every API call; plan it as its own tested project, together with enforcing a strict CSP (section 2).
- **Penetration test:** get an independent test before selling to larger brokerages; SOC 2 later.
- **MFA for all:** two-step sign-in is optional per user today; consider requiring it for admins and team owners.
