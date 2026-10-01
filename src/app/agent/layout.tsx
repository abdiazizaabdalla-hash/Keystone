'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Lightweight mirror of the TC sidebar (dashboard/layout.tsx) -- just
// two destinations an agent actually has (their deals, and now their
// messages), plus the same Logout action that used to live only on the
// hub page header. Skipped on the pre-login/activation flow pages
// (/agent/login, /agent/accept, /agent/welcome), which are their own
// centered full-screen steps, not part of the logged-in portal shell.
const BARE_PREFIXES = ['/agent/login', '/agent/accept', '/agent/welcome'];

function SideLink({ href, label, active, icon }: { href: string; label: string; active: boolean; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition font-medium ${
        active ? 'bg-slate-700 text-slate-100' : 'text-slate-300 hover:bg-slate-700/60 hover:text-slate-100'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (BARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return <>{children}</>;
  }

  const isMessages = pathname === '/agent/messages' || pathname.includes('/messages');
  const isInvoices = pathname.startsWith('/agent/invoices');
  const isSettings = pathname.startsWith('/agent/settings');
  const isDeals = !isMessages && !isInvoices && !isSettings;

  return (
    <div className="h-screen bg-slate-900 flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-56 shrink-0 bg-gradient-to-b from-slate-800 to-slate-900 border-r border-slate-700 flex flex-col">
        <div className="border-b border-slate-700 p-5 flex items-center gap-3">
          <img src="/relay-icon.png" alt="Relay TC" className="w-9 h-9 object-contain bg-white rounded-lg p-1 shrink-0" />
          <h1 className="text-white font-display font-semibold truncate">Relay TC</h1>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1">
          <SideLink
            href="/agent"
            label="Deals"
            active={isDeals}
            icon={
              <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5z" />
                <path d="M13 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2h-2z" />
                <path d="M5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5z" />
                <path d="M13 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2h-2z" />
              </svg>
            }
          />
          <SideLink
            href="/agent/messages"
            label="Messages"
            active={isMessages}
            icon={
              <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z"
                  clipRule="evenodd"
                />
              </svg>
            }
          />
          <SideLink
            href="/agent/invoices"
            label="Invoices"
            active={isInvoices}
            icon={
              <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm0 2h12v2H4V6zm0 4h12v4H4v-4z"
                  clipRule="evenodd"
                />
              </svg>
            }
          />
          <SideLink
            href="/agent/settings"
            label="Settings"
            active={isSettings}
            icon={
              <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                  clipRule="evenodd"
                />
              </svg>
            }
          />
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
