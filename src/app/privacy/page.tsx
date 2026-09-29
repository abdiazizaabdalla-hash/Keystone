import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy - Relay TC',
};

export default function PrivacyPage() {
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
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Legal</p>
        <h1 className="font-display text-4xl font-semibold text-slate-100 mb-3">Privacy Policy</h1>
        <p className="text-slate-500 text-sm mb-12">Last updated: [DATE]</p>

        <div className="prose prose-invert prose-slate max-w-none text-slate-300 leading-relaxed space-y-8">
          <p className="!mt-0 rounded-lg border border-amber-700/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
            Placeholder notice: bracketed fields like [LEGAL ENTITY NAME] need your actual business details before this
            page goes live, and this document has not been reviewed by a lawyer. It is a reasonable starting point for a
            small SaaS, not a substitute for legal advice — consider having an attorney review it, especially if you
            plan to serve customers in the EU/UK (GDPR) or California (CCPA), which have specific additional
            requirements this template does not fully cover.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">1. Overview</h2>
            <p>
              This Privacy Policy explains how [LEGAL ENTITY NAME] (&quot;Relay,&quot; &quot;we,&quot; &quot;us&quot;) collects, uses, and
              shares information when you use Relay TC. By using Relay, you agree to the collection and use of
              information as described here.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">2. Information We Collect</h2>
            <p><strong className="text-slate-200">Account information:</strong> name, email address, and password (stored in hashed form) when you sign up.</p>
            <p><strong className="text-slate-200">Transaction data:</strong> the property, agent, checklist, invoice, and document information you enter or upload to manage your transactions, including files you upload for signing or recordkeeping.</p>
            <p><strong className="text-slate-200">Payment information:</strong> if you subscribe to a paid plan or connect a Stripe account to collect payments from agents, your payment card details are collected and processed directly by Stripe — we do not receive or store full card numbers on our own servers.</p>
            <p><strong className="text-slate-200">Usage information:</strong> log data such as IP address, browser type, and pages visited, collected automatically to help us operate and secure the service.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">3. How We Use Information</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>To provide, maintain, and improve the Relay platform.</li>
              <li>To process subscription billing and, where applicable, payments you collect from agents through Stripe Connect.</li>
              <li>To send transactional emails (confirmations, password resets, invoices, signing requests) through our email provider, Resend.</li>
              <li>To respond to support requests and communicate with you about your account.</li>
              <li>To detect, prevent, and address fraud, abuse, or security issues.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">4. Who We Share Information With</h2>
            <p>We do not sell your personal information. We share information only with:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong className="text-slate-200">Supabase</strong> — our database, authentication, and file storage provider, which hosts the underlying data described above.</li>
              <li><strong className="text-slate-200">Stripe</strong> — our payment processor, for subscription billing and for TC-to-agent payments made through Stripe Connect.</li>
              <li><strong className="text-slate-200">Resend</strong> — our transactional email provider, used to deliver account and transaction-related emails.</li>
              <li><strong className="text-slate-200">Vercel</strong> — our hosting provider, which serves the application.</li>
              <li>Other parties you explicitly choose to share data with through Relay&apos;s own features, such as sending a signing request or invoice to an agent&apos;s email address.</li>
              <li>Law enforcement or regulators, where required by law or to protect our rights or the safety of others.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">5. Data Retention</h2>
            <p>
              We retain your account and transaction data for as long as your account is active, and for a reasonable
              period afterward to comply with legal, accounting, or dispute-resolution obligations. You may request
              deletion of your account and associated data at any time by contacting us; some information may be
              retained where required by law or legitimate business record-keeping needs (for example, billing
              history).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">6. Security</h2>
            <p>
              We use industry-standard measures to protect your information, including encrypted connections (HTTPS),
              access controls that scope each account to its own data, and short-lived signed links for document
              downloads rather than public file URLs. No method of transmission or storage is completely secure, and
              we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">7. Your Rights and Choices</h2>
            <p>
              Depending on where you live, you may have the right to access, correct, export, or delete your personal
              information, or to object to certain processing. You can update most account information directly in
              your dashboard, or contact us at{' '}
              <a href="mailto:support@relaytc.com" className="text-blue-400 hover:text-blue-300">support@relaytc.com</a>{' '}
              to make a request.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">8. Cookies</h2>
            <p>
              We use essential cookies to keep you signed in and to remember basic preferences. We do not currently use
              third-party advertising or tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">9. Children&apos;s Privacy</h2>
            <p>
              Relay is intended for business use by licensed real estate professionals and is not directed at, or
              knowingly used to collect information from, children under 18.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Material changes will be communicated by email or
              through the app before they take effect.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">11. Contact</h2>
            <p>
              Questions about this policy or your data? Contact us at{' '}
              <a href="mailto:support@relaytc.com" className="text-blue-400 hover:text-blue-300">support@relaytc.com</a>.
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
            <Link href="/terms" className="hover:text-slate-200 transition">Terms</Link>
            <Link href="/privacy" className="hover:text-slate-200 transition">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
