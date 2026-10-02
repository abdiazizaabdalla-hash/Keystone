import Link from 'next/link';

export const metadata = {
  title: 'Security - Relay TC',
};

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      {/* Nav */}
      <header className="border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="w-9 h-9 bg-white rounded-lg flex items-center justify-center p-1.5 shadow-sm">
              <img src="/relay-icon.png" alt="Relay TC" className="w-full h-full object-contain" />
            </span>
          </Link>
          <nav className="hidden sm:flex items-center gap-8 text-sm text-slate-300">
            <Link href="/pricing" className="hover:text-slate-100 transition">Pricing</Link>
            <Link href="/faq" className="hover:text-slate-100 transition">FAQ</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/auth" className="text-sm text-slate-300 hover:text-slate-100 transition">Sign In</Link>
          </div>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-6 pt-16 pb-24">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Trust</p>
        <h1 className="font-display text-4xl font-semibold text-slate-100 mb-3">Security</h1>
        <p className="text-slate-500 text-sm mb-12">
          How Relay TC protects your transaction data. This describes our actual architecture, not a
          compliance checklist — we are not currently SOC 2 or ISO 27001 certified. If you need specific
          documentation for your own due diligence, reach out at{' '}
          <a href="mailto:support@relaytc.com" className="text-blue-400 hover:text-blue-300">support@relaytc.com</a>.
        </p>

        <div className="prose prose-invert prose-slate max-w-none text-slate-300 leading-relaxed space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">Authentication &amp; sessions</h2>
            <p>
              There&apos;s no session cookie anywhere in Relay. Every sign-in — whether you&apos;re a TC or an
              invited agent — issues an access token and a refresh token, and every single API call carries
              that access token. Tokens refresh automatically shortly before they expire, so a long-open tab
              doesn&apos;t silently drop your session, and a stolen token can&apos;t be replayed indefinitely
              the way a stolen cookie sometimes can.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">Authorization: enforced in our code, not left to the database</h2>
            <p>
              On every protected request, our servers verify that bearer token, resolve it to a specific
              user, and separately check whether that user is a platform administrator. From there,
              authorization is never left to the database to decide on its own — our application code,
              on every single route, explicitly checks who is allowed to touch what: does this transaction
              belong to this TC (or, for read access only, their team), or does this agent have an
              explicit grant on this exact transaction. Nothing is ever opened up more broadly than that —
              a team member can see a teammate&apos;s work but can&apos;t change it, and an agent&apos;s
              access never extends beyond the specific deals they were individually added to.
            </p>
            <p>
              This is a deliberate design choice: real enforcement happens in our application code, with
              the database&apos;s own row-level protections serving only as an unused backstop. It means
              every new feature that touches a transaction has had to explicitly decide, route by route,
              who gets to read it and who gets to change it, rather than relying on a blanket rule that
              could quietly open a gap.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">Encryption</h2>
            <p>
              All traffic to and from Relay runs over HTTPS. Passwords are never stored by us directly —
              authentication is handled by Supabase Auth, which stores only a salted hash, never a plain
              password. The one genuinely sensitive secret we store at rest beyond that — a connected
              Google account&apos;s refresh token, used for calendar sync — is encrypted before it ever
              reaches our database, and only decrypted in memory at the moment it&apos;s needed.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">Payment data</h2>
            <p>
              Relay never receives or stores your full card number. Subscription billing and any payments
              you collect from agents through Stripe Connect are handled directly by Stripe on a
              Stripe-hosted page — Stripe is a PCI-DSS-compliant payment processor, and your card details
              never pass through our servers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">File storage</h2>
            <p>
              Every document you upload — contracts, disclosures, signed PDFs — lives in a private storage
              bucket, never a public one. Nothing is reachable by guessing a URL; every link handed to a
              browser is temporary (a signed URL that expires, typically within the hour) and tied to that
              specific file and your specific permission to see it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">Rate limiting</h2>
            <p>
              Sign-in, sign-up, password-reset requests, and public token-based links (e-signature and
              external-access links) are all rate-limited per IP address and per email or token, so a
              script can&apos;t hammer any of those endpoints. If a rate-limit check itself ever fails for
              an unrelated reason, it fails open rather than locking real users out during an outage.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">Infrastructure &amp; subprocessors</h2>
            <p>We rely on a small number of established providers to run Relay, each handling a specific part of the stack:</p>
            <ul className="space-y-2">
              <li><strong className="text-slate-200">Supabase</strong> — database, authentication, and file storage.</li>
              <li><strong className="text-slate-200">Stripe</strong> — subscription billing and TC-to-agent payments (Stripe Connect).</li>
              <li><strong className="text-slate-200">Resend</strong> — all transactional email (invoices, signature requests, team invites, due-date reminders, inbound email).</li>
              <li><strong className="text-slate-200">Vercel</strong> — application hosting.</li>
              <li><strong className="text-slate-200">Anthropic</strong> — optional AI contract-field extraction, only when you upload a contract on the New Transaction page; nothing is sent there unless you use that feature.</li>
            </ul>
            <p>See our <Link href="/privacy" className="text-blue-400 hover:text-blue-300">Privacy Policy</Link> for how data is shared with each of these.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">Reporting a vulnerability</h2>
            <p>
              If you believe you&apos;ve found a security issue in Relay, please email{' '}
              <a href="mailto:support@relaytc.com" className="text-blue-400 hover:text-blue-300">support@relaytc.com</a>{' '}
              with details. We don&apos;t yet have a formal bug-bounty program, but we take reports
              seriously and will respond as quickly as we can.
            </p>
          </section>
        </div>
      </section>

      <footer className="border-t border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 bg-white rounded-md flex items-center justify-center p-1 shadow-sm">
              <img src="/relay-icon.png" alt="Relay TC" className="w-full h-full object-contain" />
            </span>
            <span className="font-brand font-extrabold text-sm text-slate-300">Relay TC</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <Link href="/pricing" className="hover:text-slate-200 transition">Pricing</Link>
            <Link href="/faq" className="hover:text-slate-200 transition">FAQ</Link>
            <Link href="/changelog" className="hover:text-slate-200 transition">Changelog</Link>
            <Link href="/status" className="hover:text-slate-200 transition">Status</Link>
            <Link href="/terms" className="hover:text-slate-200 transition">Terms</Link>
            <Link href="/privacy" className="hover:text-slate-200 transition">Privacy</Link>
            <Link href="/auth" className="hover:text-slate-200 transition">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
