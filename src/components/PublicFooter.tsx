import Link from 'next/link';

export default function PublicFooter() {
  return (
    <footer className="border-t border-slate-700">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-slate-500">© {new Date().getFullYear()} Relay TC</p>
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
          <Link href="/pricing" className="hover:text-slate-200 transition">Pricing</Link>
          <Link href="/faq" className="hover:text-slate-200 transition">FAQ</Link>
          <Link href="/for-tcs" className="hover:text-slate-200 transition">For TCs</Link>
          <Link href="/for-teams" className="hover:text-slate-200 transition">For Teams</Link>
          <Link href="/auth" className="hover:text-slate-200 transition">Sign In</Link>
          <Link href="/terms" className="hover:text-slate-200 transition">Terms</Link>
          <Link href="/privacy" className="hover:text-slate-200 transition">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}
