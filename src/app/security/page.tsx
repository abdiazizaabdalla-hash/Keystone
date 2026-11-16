import Link from 'next/link';
import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';

// Only list controls that exist in the product today (see docs/SECURITY-OPERATIONS.md). Planned items stay in the "Next" list.

const IN_PLACE: { title: string; body: string }[] = [
  { title: 'Private document storage', body: 'Transaction documents sit in a private store. They are never public, and each one is shared only through the links and logins you create.' },
  { title: 'Locked-down database', body: 'Database access is closed by default and opened per feature on the server, so a browser cannot read other customers’ data directly.' },
  { title: 'Two-step sign-in', body: 'Turn on an authenticator app for your account in Account settings. Clients and agents you share with get their own limited access.' },
  { title: 'Audit log', body: 'Sign-ins, downloads, invoices, deletions and changes to team access are recorded with who did them and when.' },
  { title: 'Your data, on request', body: 'Download everything in your account as a file from Account settings. Ask for deletion there too, and we confirm and complete it within 30 days.' },
  { title: 'Payments through Stripe', body: 'Card and bank details are handled by Stripe. Relay never stores them.' },
  { title: 'Roles that limit what people see', body: 'Team members, administrators, agents and clients each see only what their role allows. On a TC team, each coordinator’s files stay private from the others.' },
  { title: 'Signed documents with a record', body: 'E-signature requests keep a record of who signed and when, next to the file.' },
];

const NEXT: string[] = [
  'An independent security review before we take on larger brokerages',
  'Requiring two-step sign-in for administrators and team owners',
  'SOC 2, later',
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-slate-900">
      <PublicHeader active="/security" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-12 text-center">
        <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase mb-4">Security and trust</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-100 mb-5">Your files are your clients’ files.</h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto">A transaction holds contracts, financial details and personal information. Here is what protects it in Relay today, and what we are working on next.</p>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-16">
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-6">In place today</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {IN_PLACE.map((i) => (
            <div key={i.title} className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
              <h3 className="font-semibold text-slate-100 mb-2">{i.title}</h3>
              <p className="text-sm text-slate-400">{i.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-14 border-t border-slate-700">
        <h2 className="font-display text-2xl font-semibold text-slate-100 mb-4">Next</h2>
        <ul className="space-y-2 text-slate-300">
          {NEXT.map((n) => (
            <li key={n} className="flex items-start gap-2.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2.5 flex-shrink-0" />{n}</li>
          ))}
        </ul>
        <p className="text-sm text-slate-500 mt-6">Relay does not yet hold a SOC 2 report or an independent penetration test. If your brokerage needs a security questionnaire answered, <Link href="/for-brokerages" className="text-blue-400 hover:text-blue-300">ask for a demo</Link> and we will go through it with you.</p>
      </section>

      <PublicFooter />
    </div>
  );
}
