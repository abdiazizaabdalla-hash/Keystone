'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearSession, fetchHasWorkspace } from '@/lib/authClient';
import NotificationBell from '@/components/NotificationBell';
import ToastHost from '@/components/ToastHost';

// Lightweight mirror of the TC sidebar (dashboard/layout.tsx) -- just
// destinations an agent actually has (deals, messages, invoices, settings),
// plus the same Logout button at the bottom that the TC sidebar has. Skipped on the pre-login/activation flow pages
// (/agent/login, /agent/accept, /agent/welcome), which are their own
// centered full-screen steps, not part of the logged-in portal shell.
const BARE_PREFIXES = ['/agent/login', '/agent/accept', '/agent/welcome'];

function SideLink({
  href,
  label,
  active,
  icon,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center shrink-0 gap-2 rounded-lg transition font-medium text-sm px-2.5 py-2 ${active ? 'bg-slate-700 text-slate-100' : 'text-slate-300 hover:bg-slate-700/60 hover:text-slate-100'}`}
    >
      {icon}
      <span className="hidden lg:inline truncate">{label}</span>
    </Link>
  );
}

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Phones only: the sidebar becomes a slide-down menu behind a top bar.
  const [mobileOpen, setMobileOpen] = useState(false);
  // An agent the admin gave a workspace to gets a way back to it from the shared-deals portal.
  const [hasWorkspace, setHasWorkspace] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchHasWorkspace().then((has) => {
      if (cancelled) return;
      setHasWorkspace(has);
      // /agent is the view for FREE agent logins. An agent with their own workspace (paid or granted) works in /dashboard,
      // where deals they were added to sit in their normal list with a "Shared" badge. Send them there from any portal page
      // (the login, accept and welcome steps are left alone), keeping the listing or deal when we can.
      const path = window.location.pathname;
      if (!has || BARE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return;
      const listing = path.match(/^\/agent\/listings(?:\/([^/]+))?/);
      const deal = path.match(/^\/agent\/transactions\/([^/]+)/);
      router.replace(listing ? (listing[1] ? `/dashboard/listings/${listing[1]}` : '/dashboard/listings') : deal ? `/dashboard/transactions/${deal[1]}` : '/dashboard');
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (BARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return <>{children}</>;
  }

  // A paid/granted agent is being sent to their workspace: show nothing instead of the free portal.
  if (hasWorkspace) return null;

  const isMessages = pathname === '/agent/messages';
  const isInvoices = pathname.startsWith('/agent/invoices');
  const isSettings = pathname.startsWith('/agent/settings');
  const isListings = pathname.startsWith('/agent/listings');
  const isTransactions = pathname.startsWith('/agent/transactions');
  const isDeals = !isMessages && !isInvoices && !isSettings && !isListings && !isTransactions;

  const handleLogout = () => {
    clearSession();
    router.push('/agent/login');
  };

  return (
    <div className="h-screen bg-slate-900 flex flex-col overflow-hidden">
      {/* Phones: compact top bar + menu (the desktop sidebar below is hidden under md) */}
      <div className="md:hidden shrink-0 relative z-40 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center justify-between px-4 py-2.5">
          <Link href="/agent" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
            <img src="/relay-icon.png" alt="Relay TC" className="w-8 h-8 object-contain bg-white rounded-lg p-1" />
            <span className="text-white font-display font-semibold">Relay TC</span>
          </Link>
          <div className="flex items-center">
          <NotificationBell variant="topbar" />
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            className="p-2.5 -mr-2 text-slate-300 hover:text-slate-100 hover:bg-slate-700 rounded-lg transition"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
          </div>
        </div>
        {mobileOpen && (
          <div className="absolute left-0 right-0 top-full bg-slate-800 border-b border-slate-700 shadow-xl px-3 pb-3 space-y-1">
            {[
              ...(hasWorkspace ? [{ href: '/dashboard', label: 'My workspace', active: false }] : []),
              { href: '/agent', label: 'Dashboard', active: isDeals },
              { href: '/agent/transactions', label: 'Transactions', active: isTransactions },
              { href: '/agent/listings', label: 'Listings', active: isListings },
              { href: '/agent/messages', label: 'Messages', active: isMessages },
              { href: '/agent/invoices', label: 'Invoices', active: isInvoices },
              { href: '/agent/settings', label: 'Settings', active: isSettings },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`block px-4 py-3 rounded-lg font-medium transition ${
                  item.active ? 'bg-slate-700 text-slate-100' : 'text-slate-300 hover:bg-slate-700/60'
                }`}
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={handleLogout}
              className="w-full text-left px-4 py-3 rounded-lg font-medium text-slate-300 hover:bg-red-900/30 hover:text-red-300 border-t border-slate-700 mt-1 transition"
            >
              Logout
            </button>
          </div>
        )}
      </div>

      {/* Top navigation (tablet and desktop) */}
      <header className="hidden md:flex shrink-0 items-center gap-1 h-14 px-4 bg-gradient-to-r from-slate-800 to-slate-900 border-b border-slate-700">
        <Link href="/agent" className="flex items-center gap-2.5 min-w-0 mr-3" title="Relay TC">
          <img src="/relay-icon.png" alt="Relay TC" className="w-8 h-8 object-contain bg-white rounded-lg p-1 shrink-0" />
          <span className="text-white font-display font-semibold whitespace-nowrap">Relay TC</span>
        </Link>
        <nav className="flex items-center gap-0.5 min-w-0 flex-1" aria-label="Main">
          {hasWorkspace && (
            <SideLink
              href="/dashboard"
              label="My workspace"
                active={false}
              icon={
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10l9-7 9 7v10a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1V10z" />
                </svg>
              }
            />
          )}
          <SideLink
            href="/agent"
            label="Dashboard"
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
            href="/agent/transactions"
            label="Transactions"
            active={isTransactions}
            icon={
              <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
              </svg>
            }
          />
          <SideLink
            href="/agent/listings"
            label="Listings"
            active={isListings}
            icon={
              <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
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
        <NotificationBell variant="topbar" />
        <button
          onClick={handleLogout}
          className="px-3 py-2 text-sm text-slate-300 hover:bg-red-900/30 hover:text-red-300 rounded-lg transition"
        >
          Logout
        </button>
      </header>

      {/* Main Content */}
      <div className="flex-1 min-w-0 overflow-auto">{children}</div>
      <ToastHost />
    </div>
  );
}
