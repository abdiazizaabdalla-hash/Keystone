import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import { SUPPORT_EMAIL } from '@/lib/site';

export const metadata: Metadata = { title: 'Privacy Policy | Relay TC' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 19, 2026">
      <section>
        <p>
          This policy explains what information Relay TC (&ldquo;Relay,&rdquo; &ldquo;we&rdquo;) collects, how we use it, who we share it
          with, and the choices you have. Relay is built for real estate professionals: you will put other people&rsquo;s
          information into it (buyers, sellers, agents, lenders), so we keep the explanation specific.
        </p>
      </section>

      <section>
        <h2>Information we collect</h2>
        <ul>
          <li><strong>Account details:</strong> your name, email address, password (stored as a one-way hash by our authentication provider), plan, and the date you accepted our terms.</li>
          <li><strong>Transaction content you enter or upload:</strong> property addresses, prices, dates, checklists, contact details for parties to a deal, uploaded contracts and other documents, signatures, messages between you and your agents, and invoices.</li>
          <li><strong>Billing details:</strong> handled by Stripe. We keep a customer ID, plan, and subscription status, not full card numbers.</li>
          <li><strong>Usage and device data:</strong> basic logs such as IP address, browser type, and the actions taken (for example sign-ins and document downloads), used for security and troubleshooting.</li>
          <li><strong>Emails you forward to a transaction:</strong> if you use a transaction&rsquo;s inbound email address, the messages sent to it are stored with that transaction.</li>
        </ul>
      </section>

      <section>
        <h2>How we use it</h2>
        <ul>
          <li>to provide Relay: run checklists, store documents, send signature requests, deliver invoices and reminders, and show your agents their deals;</li>
          <li>to process payments and manage your subscription;</li>
          <li>to keep the service secure, prevent abuse, and investigate problems;</li>
          <li>to read an uploaded contract and pre-fill a transaction when you ask us to (see below);</li>
          <li>to contact you about your account, security, and changes to the service.</li>
        </ul>
        <p>We do not sell personal information and we do not use your transaction content to advertise to you or anyone else.</p>
      </section>

      <section>
        <h2>Who we share it with</h2>
        <p>We use a small number of service providers to run Relay. They process data only for us:</p>
        <ul>
          <li><strong>Supabase</strong> &mdash; database, sign-in, and file storage;</li>
          <li><strong>Vercel</strong> &mdash; hosting, and privacy-friendly page-view statistics for our public pages (no cookies, and no information about your transactions);</li>
          <li><strong>Stripe</strong> &mdash; payments and subscriptions;</li>
          <li><strong>Resend</strong> &mdash; sending and receiving email;</li>
          <li><strong>Sentry</strong> &mdash; error monitoring;</li>
          <li><strong>Google</strong> &mdash; only if you choose to connect your Google Calendar (see &ldquo;Google Calendar data&rdquo; below);</li>
          <li><strong>Intuit (QuickBooks)</strong> &mdash; only if you choose to connect QuickBooks Online (see &ldquo;QuickBooks data&rdquo; below);</li>
          <li><strong>Anthropic</strong> &mdash; when you upload a contract for automatic reading, the document is sent to Anthropic to extract the details. It is used to return the result to you.</li>
        </ul>
        <p>
          Within Relay, what others can see follows the roles you set up: an agent you add sees the deals they are on, a team
          owner sees their team&rsquo;s transactions, and a person you send a signature request to sees the document they are
          asked to sign. We may also disclose information when the law requires it or to protect people&rsquo;s safety and our
          rights, or as part of a merger or sale of the business (with notice to you).
        </p>
      </section>

      <section>
        <h2>QuickBooks data</h2>
        <p>
          Connecting QuickBooks Online is optional, and you can also move invoices with import and export files without
          connecting anything. If you connect, Relay asks Intuit for permission to work with your QuickBooks accounting data
          (the <code>com.intuit.quickbooks.accounting</code> scope).
        </p>
        <ul>
          <li><strong>What we do:</strong> create a customer for each agent you invoice, create the invoices you make in Relay, and record payments on them when they are paid. Before creating anything, Relay looks up the one customer, product or service, or invoice number it needs, so that nothing is duplicated. Relay does not edit or delete anything in QuickBooks, and we do not read or copy your other accounting records.</li>
          <li><strong>What we store:</strong> your QuickBooks company ID and name, encrypted tokens that let Relay keep invoices up to date, the QuickBooks ID of each customer, invoice, and payment Relay created, and a short note when something could not be sent. The tokens are encrypted before they are saved.</li>
          <li><strong>Who sees it:</strong> we do not sell or share QuickBooks data, and we do not use it for advertising or to train AI or machine-learning models.</li>
          <li><strong>Disconnecting:</strong> you can disconnect in Settings at any time. Relay then tells Intuit to end the connection, deletes the stored tokens, and forgets the links it kept. Everything already in QuickBooks stays there. You can also remove Relay from your Intuit account&rsquo;s connected apps.</li>
        </ul>
      </section>

      <section>
        <h2>Google Calendar data</h2>
        <p>
          Connecting a Google Calendar is optional. If you do, Relay asks Google for two permissions: to see and edit events on
          your calendars (the <code>calendar.events</code> scope) and to see your Google Account email address (the{' '}
          <code>userinfo.email</code> scope).
        </p>
        <ul>
          <li><strong>What we access:</strong> your Google Account email address, and the calendar events that Relay itself creates for your transactions and listings. We do not read, copy, or store your other calendar events.</li>
          <li><strong>What we do with it:</strong> add, update, and remove key dates (for example inspection, appraisal, and closing deadlines, and a listing&rsquo;s go-live, expiration, and open-house dates) on the calendar you connected, so they appear alongside your other appointments. If you are an agent invited to Relay by your transaction coordinator, the same applies to the dates of the deals and listings shared with you; you can connect your own calendar or leave it disconnected. Nothing else.</li>
          <li><strong>What we store:</strong> your Google email address and an encrypted token that lets Relay keep those events up to date, plus the ID of each event we created. The token is encrypted before it is saved.</li>
          <li><strong>Who sees it:</strong> we do not sell or share Google user data, and we do not use it for advertising. It is not used to build or train AI or machine-learning models.</li>
          <li><strong>Disconnecting:</strong> you can disconnect your calendar in Relay at any time, which stops syncing and deletes the stored token. You can also revoke Relay&rsquo;s access from your Google Account&rsquo;s security settings. To delete the events Relay created, remove them in Google Calendar or contact us.</li>
        </ul>
        <p>
          Relay&rsquo;s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </section>

      <section>
        <h2>How we protect it</h2>
        <p>
          Data is encrypted in transit and at rest by our providers. Documents are kept in private storage and opened only
          through short-lived signed links. Access to data is checked on the server for every request, and we limit who at Relay
          can reach production systems. No system is perfectly secure; if we learn of a breach affecting your information we
          will notify you as the law requires.
        </p>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <p>
          We keep your content while your account is active so you can use it. Temporary files we generate, such as invoice
          document bundles, are deleted automatically after a short period. When you close your account we delete or
          anonymize your content within a reasonable period (typically within 30 days), except records we must keep for tax,
          accounting, or legal reasons and backups that expire on their normal cycle.
        </p>
      </section>

      <section>
        <h2>Your choices and rights</h2>
        <ul>
          <li><strong>Access and export:</strong> you can download a copy of your data from your Account page.</li>
          <li><strong>Correction:</strong> you can edit your information in the app.</li>
          <li><strong>Deletion:</strong> you can request deletion of your account and data from your Account page, or by emailing us.</li>
          <li>Depending on where you live, you may have additional rights (for example under California law) to know what we hold, correct it, delete it, or object to certain uses. Contact us and we will respond within the time the law requires.</li>
        </ul>
        <p>
          If you are the buyer, seller, or other party on someone else&rsquo;s transaction and want your information corrected or
          removed, contact the coordinator or agent who entered it, or email us and we will help.
        </p>
      </section>

      <section>
        <h2>Cookies and local storage</h2>
        <p>
          Relay uses your browser&rsquo;s local storage to keep you signed in and to remember interface settings such as whether a
          sidebar is collapsed. We do not use advertising cookies or third-party ad trackers. On our public marketing pages we count visits with cookie-free analytics (page, referring site, country, device type); it is not used inside your signed-in workspace.
        </p>
      </section>

      <section>
        <h2>Children</h2>
        <p>Relay is for business use by adults and is not directed to children under 16.</p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          We will post updates here and, for meaningful changes, tell you in the app or by email before they take effect.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Privacy questions and requests: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </section>
    </LegalPage>
  );
}
