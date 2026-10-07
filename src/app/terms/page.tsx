import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import { SUPPORT_EMAIL } from '@/lib/site';

export const metadata: Metadata = { title: 'Terms of Service | Relay TC' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="October 7, 2026">
      <section>
        <p>
          These terms govern your use of Relay TC (&ldquo;Relay,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;), a web application that helps
          transaction coordinators and real estate agents manage the work between an accepted contract and closing. By
          creating an account or using Relay you agree to these terms. If you use Relay on behalf of a brokerage or other
          organization, you confirm you are allowed to accept these terms for it.
        </p>
      </section>

      <section>
        <h2>1. Your account</h2>
        <p>
          You must provide accurate information, keep your password confidential, and tell us promptly if you think your
          account has been accessed without your permission. You are responsible for activity under your account,
          including activity by teammates you add and agents you invite.
        </p>
      </section>

      <section>
        <h2>2. What Relay is, and what it is not</h2>
        <p>
          Relay is organizational software. It is not a brokerage, escrow or title company, law firm, or financial
          institution, and nothing in Relay is legal, tax, or financial advice. You remain responsible for your
          transactions, deadlines, compliance with state and brokerage requirements, and the accuracy of what you enter.
        </p>
        <p>
          Features that read a contract automatically, compute due dates, or pre-fill a transaction can make mistakes.
          Always review them before relying on them.
        </p>
      </section>

      <section>
        <h2>3. Your data</h2>
        <p>
          You own the content you put into Relay, including transactions, documents, messages, and contact details
          (&ldquo;Your Content&rdquo;). You give us permission to store, process, and display it only as needed to run the service for
          you and the people you choose to share it with. You are responsible for having the right to upload what you upload
          and for obtaining any consent required from the people whose information you enter. How we handle personal
          information is described in our <a href="/privacy">Privacy Policy</a>.
        </p>
      </section>

      <section>
        <h2>4. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>break the law or use Relay to defraud, harass, or deceive anyone;</li>
          <li>upload malware, or attempt to access data that is not yours, probe or disrupt the service, or bypass its limits or security;</li>
          <li>resell or provide Relay to others as a competing service, or scrape or copy it at scale;</li>
          <li>share your login or let someone else use a seat you have not paid for.</li>
        </ul>
        <p>We may suspend or limit an account that breaks these rules or puts the service or other users at risk.</p>
      </section>

      <section>
        <h2>5. Plans, billing, and the free trial</h2>
        <p>
          Relay offers a free trial and paid plans, with the current prices and limits shown on our{' '}
          <a href="/pricing">pricing page</a>. Paid plans renew automatically each month until cancelled. Payments are
          processed by Stripe; we do not store full card numbers. Team plans are billed per seat, and adding a seat is charged
          on the spot. Fees already paid are not refunded except where required by law. You can cancel from your account at
          any time and keep access until the end of the paid period. We may change prices with advance notice; changes take
          effect at your next renewal.
        </p>
        <p>
          If you use Relay&rsquo;s invoicing to collect fees from agents, those payments go through your own Stripe account. The
          arrangement between you and your agents is yours, and you are responsible for it.
        </p>
      </section>

      <section>
        <h2>6. Electronic signatures</h2>
        <p>
          Relay lets you request and collect electronic signatures on documents. Relay records the signer&rsquo;s consent, name,
          time, and device details and stamps a certificate onto the signed PDF. Whether a particular document may be signed
          electronically, and what it must contain, depends on the document and the laws that apply to it. You are
          responsible for deciding that.
        </p>
      </section>

      <section>
        <h2>7. Availability and changes</h2>
        <p>
          We work to keep Relay available and your data safe, but we provide it &ldquo;as is&rdquo; and do not promise it will be
          uninterrupted or error-free. We may change or retire features, and will give notice of changes that significantly
          reduce what a paid plan includes.
        </p>
      </section>

      <section>
        <h2>8. Ending your account</h2>
        <p>
          You can stop using Relay at any time. You can ask us to delete your account and data (see the Privacy Policy). We
          may close accounts that break these terms or go unused for a long period, with notice where reasonable. After
          closure we delete or anonymize your content within a reasonable period, except where we must keep records by law or
          for legitimate business reasons such as payment records.
        </p>
      </section>

      <section>
        <h2>9. Liability</h2>
        <p>
          To the fullest extent the law allows, Relay is not liable for indirect, incidental, special, or consequential
          losses, lost profits, lost commissions, or missed deadlines arising from your use of the service, and our total
          liability for any claim is limited to the amount you paid us in the 12 months before the claim arose. Nothing here
          limits liability that cannot legally be limited. You agree to cover claims brought against us by third parties
          because of Your Content or your misuse of the service.
        </p>
      </section>

      <section>
        <h2>10. General</h2>
        <p>
          These terms are the whole agreement between you and us about Relay. If part of them is found unenforceable, the rest
          stays in effect. We may update these terms; if a change is significant we will tell you in the app or by email, and
          continued use after the change means you accept it. These terms are governed by the laws of the United States and
          the state in which Relay TC is organized.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about these terms: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </section>
    </LegalPage>
  );
}
