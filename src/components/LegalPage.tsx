import Link from 'next/link';

// Shared shell for the Terms and Privacy pages: same dark public-site
// header/footer feel, with a readable single-column document body.
export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <header className="border-b border-slate-700">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="w-8 h-8 bg-white rounded-lg flex items-center justify-center p-1">
              <img src="/relay-icon.png" alt="Relay TC" className="w-full h-full object-contain" />
            </span>
            <span className="font-brand font-extrabold text-slate-100">Relay TC</span>
          </Link>
          <Link href="/auth" className="text-sm text-slate-300 hover:text-slate-100 transition">
            Sign in
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 md:px-6 py-10 md:py-14">
        <h1 className="text-3xl md:text-4xl font-display font-semibold text-slate-100 mb-2">{title}</h1>
        <p className="text-sm text-slate-500 mb-10">Last updated {updated}</p>
        <div className="space-y-8 text-slate-300 leading-relaxed [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-100 [&_h2]:mb-3 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5 [&_ul]:mb-3 [&_a]:text-blue-400 [&_a:hover]:text-blue-300">
          {children}
        </div>
      </main>
      <footer className="border-t border-slate-700">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500">
          <Link href="/terms" className="hover:text-slate-200 transition">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-slate-200 transition">Privacy Policy</Link>
          <Link href="/" className="hover:text-slate-200 transition">Home</Link>
        </div>
      </footer>
    </div>
  );
}
