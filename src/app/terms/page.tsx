import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service - Relay TC',
};

export default function TermsPage() {
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
        <h1 className="font-display text-4xl font-semibold text-slate-100 mb-3">Terms of Service</h1>
        <p className="text-slate-500 text-sm mb-12">Last updated: [DATE]</p>

        <div className="prose prose-invert prose-slate max-w-none text-slate-300 leading-relaxed space-y-8">
          <p className="!mt-0 rounded-lg border border-amber-700/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
            Placeholder notice: bracketed fields like [LEGAL ENTITY NAME] need your actual business details before this
            page goes live, and this document has not been reviewed by a lawyer. It is a reasonable starting point for a
            small SaaS, not a substitute for legal advice — consider having an attorney review it before relying on it.
          </p>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">1. Agreement to Terms</h2>
            <p>
              These Terms of Service (&quot;Terms&quot;) govern your access to and use of Relay TC (&quot;Relay,&quot; &quot;we,&quot;
              &quot;us,&quot; or &quot;our&quot;), a transaction coordination platform for real estate professionals, operated by
              [LEGAL ENTITY NAME], located at [BUSINESS ADDRESS]. By creating an account or using Relay, you agree to
              be bound by these Terms. If you do not agree, do not use the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">2. Who Can Use Relay</h2>
            <p>
              You must be at least 18 years old and able to form a binding contract to use Relay. If you use Relay on
              behalf of a brokerage, team, or other organization, you represent that you have authority to bind that
              organization to these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">3. Your Account</h2>
            <p>
              You are responsible for maintaining the confidentiality of your login credentials and for all activity
              under your account. Notify us promptly at{' '}
              <a href="mailto:support@relaytc.com" className="text-blue-400 hover:text-blue-300">support@relaytc.com</a>{' '}
              if you suspect unauthorized access to your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">4. Subscriptions and Billing</h2>
            <p>
              Paid plans are billed in advance on a recurring basis through our payment processor, Stripe. By
              subscribing, you authorize us to charge your payment method for the applicable fees. Plans renew
              automatically until cancelled. You can cancel at any time from your dashboard; cancellation takes effect
              at the end of the current billing period, and we do not provide prorated refunds for partial periods
              except where required by law.
            </p>
            <p>
              If you invoice agents or other parties for fees using Relay&apos;s invoicing features and accept payment
              through Stripe Connect, those payments are processed directly between you and Stripe under Stripe&apos;s own
              terms; Relay is not a party to those transactions and does not hold or transfer funds itself.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">5. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Use Relay for any unlawful purpose or in violation of any applicable real estate, licensing, or data-protection law.</li>
              <li>Upload content you don&apos;t have the right to share, or that infringes another person&apos;s rights.</li>
              <li>Attempt to gain unauthorized access to other accounts, transactions, or data on the platform.</li>
              <li>Interfere with or disrupt the integrity or performance of the service.</li>
              <li>Use the service to send unsolicited communications outside the ordinary course of a real estate transaction.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">6. Your Content and Data</h2>
            <p>
              You retain ownership of the transaction data, documents, and other content you upload to Relay
              (&quot;Your Content&quot;). You grant us a limited license to host, store, and process Your Content solely to
              provide and improve the service. You are responsible for having the necessary rights and permissions
              (including from agents, clients, and other parties) to upload their information to Relay.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">7. Third-Party Services</h2>
            <p>
              Relay relies on third-party providers to operate, including Stripe (payments), Supabase (database,
              authentication, and file storage), and Resend (transactional email). Your use of Relay is also subject to
              those providers&apos; applicable terms where you interact with them directly (for example, entering payment
              details on a Stripe-hosted checkout page).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">8. E-Signatures</h2>
            <p>
              Relay&apos;s document-signing feature is intended to facilitate the collection of electronic signatures
              between you and third parties (such as agents) you invite to sign. You are responsible for confirming
              that electronic signatures are appropriate and legally sufficient for the specific documents and
              jurisdiction involved in your transactions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">9. Disclaimers</h2>
            <p>
              Relay is provided &quot;as is&quot; and &quot;as available,&quot; without warranties of any kind, express or implied,
              including warranties of merchantability, fitness for a particular purpose, and non-infringement. We do
              not guarantee that the service will be uninterrupted, error-free, or completely secure. Relay is a
              workflow and organization tool — it does not provide legal, financial, or real estate brokerage advice,
              and does not replace your professional judgment or licensing obligations.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">10. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, [LEGAL ENTITY NAME] will not be liable for any indirect,
              incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or
              goodwill, arising from your use of Relay. Our total liability for any claim arising from these Terms or
              the service will not exceed the amount you paid us in the twelve months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">11. Termination</h2>
            <p>
              You may stop using Relay and cancel your subscription at any time. We may suspend or terminate your
              account if you violate these Terms, or if required to comply with the law. Upon termination, your right
              to access the service ends, though we may retain data as described in our{' '}
              <Link href="/privacy" className="text-blue-400 hover:text-blue-300">Privacy Policy</Link> or as required by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">12. Changes to These Terms</h2>
            <p>
              We may update these Terms from time to time. If we make material changes, we will notify you by email or
              through the app. Continued use of Relay after changes take effect constitutes acceptance of the updated
              Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">13. Governing Law</h2>
            <p>
              These Terms are governed by the laws of [GOVERNING LAW STATE/JURISDICTION], without regard to its
              conflict-of-laws principles.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-100 mb-3">14. Contact</h2>
            <p>
              Questions about these Terms? Reach us at{' '}
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
