'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearSession } from '@/lib/authClient';

// Lightweight mirror of the TC sidebar (dashboard/layout.tsx) -- just
// destinations an agent actually has (deals, messages, invoices, settings),
// plus the same Logout button at the bottom that the TC sidebar has. Skipped on the pre-login/activation flow pages
// (/agent/login, /agent/accept, /agent/welcome), which are their own
// centered full-screen steps, not part of the logged-in portal shell.
const BARE_PREFIXES = ['/agent/login', '/agent/accept', '/agent/welcome'];

// Same collapse behavior as the TC sidebar: icon-only when collapsed,
// remembered per device, and collapsed by default on phones.
const SIDEBAR_COLLAPSED_KEY = 'agent_sidebar_collapsed';

function SideLink({
  href,
  label,
  active,
  icon,
  collapsed,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: React.ReactNode;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={`flex items-center rounded-lg transition font-medium ${
        collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-4 py-3'
      } ${active ? 'bg-slate-700 text-slate-100' : 'text-slate-300 hover:bg-slate-700/60 hover:text-slate-100'}`}
    >
      {icon}
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const initCollapsed = async () => {
      // Deferred a tick so the first client render matches the server markup.
      await Promise.resolve();
      try {
        const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
        if (stored === 'true' || stored === 'false') {
          setCollapsed(stored === 'true');
        } else if (window.innerWidth < 768) {
          setCollapsed(true);
        }
      } catch {
        // localStorage can throw in private-browsing modes; default to expanded.
      }
    };
    initCollapsed();
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Non-critical -- the preference just won't persist.
      }
      return next;
    });
  };

  if (BARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return <>{children}</>;
  }

  const isMessages = pathname === '/agent/messages' || pathname.includes('/messages');
  const isInvoices = pathname.startsWith('/agent/invoices');
  const isSettings = pathname.startsWith('/agent/settings');
  const isDeals = !isMessages && !isInvoices && !isSettings;

  const handleLogout = () => {
    clearSession();
    router.push('/agent/login');
  };

  return (
    <div className="h-screen bg-slate-900 flex overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${
          collapsed ? 'w-20' : 'w-56'
        } shrink-0 h-full bg-gradient-to-b from-slate-800 to-slate-900 border-r border-slate-700 flex flex-col transition-all duration-200`}
      >
        <div
          className={`border-b border-slate-700 flex items-center ${
            collapsed ? 'justify-center px-3 py-4' : 'justify-between p-5'
          }`}
        >
          <Link href="/agent" className="flex items-center gap-3 min-w-0" title={collapsed ? 'Relay TC' : undefined}>
            <img src="/relay-icon.png" alt="Relay TC" className="w-9 h-9 object-contain bg-white rounded-lg p-1 shrink-0" />
            {!collapsed && <h1 className="text-white font-display font-semibold truncate">Relay TC</h1>}
          </Link>
          {!collapsed && (
            <button
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="shrink-0 p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-md transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
        {collapsed && (
          <div className="flex justify-center py-2 border-b border-slate-700">
            <button
              onClick={toggleCollapsed}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-md transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        <nav className={`flex-1 min-h-0 overflow-y-auto py-6 space-y-2 ${collapsed ? 'px-2' : 'px-3'}`}>
          <SideLink
            href="/agent"
            label="Deals"
            collapsed={collapsed}
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
            collapsed={collapsed}
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
            collapsed={collapsed}
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
            collapsed={collapsed}
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

        <div className={`border-t border-slate-700 ${collapsed ? 'p-2' : 'p-4'}`}>
          <button
            onClick={handleLogout}
            title={collapsed ? 'Logout' : undefined}
            className={`w-full flex items-center justify-center text-slate-300 hover:bg-red-900/30 hover:text-red-300 rounded-lg transition text-sm py-2 ${
              collapsed ? 'px-0' : 'px-4'
            }`}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
