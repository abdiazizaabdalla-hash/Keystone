import Link from 'next/link';
import PublicMobileMenu from '@/components/PublicMobileMenu';

export const PUBLIC_NAV = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
  { href: '/for-agents', label: 'For Agents' },
  { href: '/for-tcs', label: 'For TCs' },
  { href: '/for-teams', label: 'For Teams' },
] as const;

export default function PublicHeader({ active }: { active?: string }) {
  return (
    <header className="border-b border-slate-700">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PublicMobileMenu />
          <Link href="/" className="flex items-center gap-2">
            <span className="w-9 h-9 bg-white rounded-lg flex items-center justify-center p-1.5 shadow-sm">
              <img src="/relay-icon.png" alt="Relay TC" className="w-full h-full object-contain" />
            </span>
          </Link>
        </div>
        <nav className="hidden sm:flex items-center gap-6 text-sm text-slate-300">
          <Link href="/" className="hover:text-slate-100 transition">Home</Link>
          {PUBLIC_NAV.map((l) => (
            <Link key={l.href} href={l.href} className={l.href === active ? 'text-slate-100' : 'hover:text-slate-100 transition'}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-4">
          <Link
            href="/agent/login"
            className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-500/40 bg-blue-500/10 text-sm text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 transition whitespace-nowrap"
          >
            Agent Login
          </Link>
          <Link href="/auth" className="hidden sm:inline text-sm text-slate-300 hover:text-slate-100 transition whitespace-nowrap">Sign In</Link>
          <Link
            href="/auth?mode=signup&plan=starter"
            className="px-3 sm:px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition whitespace-nowrap"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
