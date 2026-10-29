'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/authClient';

interface NotificationItem {
  id: string;
  event_type: string;
  title: string;
  body: string | null;
  link: string | null;
  event_count: number;
  read_at: string | null;
  created_at: string;
}

// Mirrors NOTIFICATION_TYPES in lib/notifications.ts (that file imports
// server-only code, so the labels are repeated here).
const SETTINGS: { type: string; label: string }[] = [
  { type: 'message', label: 'New messages' },
  { type: 'task_completed', label: 'Checklist steps completed' },
  { type: 'stage_changed', label: 'Stage changes' },
  { type: 'date_changed', label: 'Deadline changes' },
  { type: 'document_added', label: 'New documents' },
  { type: 'client_viewed', label: 'Client opened their progress link' },
];

const POLL_MS = 30_000;

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
      />
    </svg>
  );
}

/**
 * The notification bell for both the TC dashboard and the agent portal.
 * `sidebar` is a row in the desktop sidebar (the panel pops out to its
 * right); `topbar` is the compact icon in the phone top bar.
 */
export default function NotificationBell({
  variant,
  collapsed = false,
  sidebarRem = 16,
}: {
  variant: 'sidebar' | 'topbar';
  collapsed?: boolean;
  /** Width of the sidebar in rem, so the panel opens just to its right. */
  sidebarRem?: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [muted, setMuted] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data.notifications) ? data.notifications : []);
      setUnread(typeof data.unreadCount === 'number' ? data.unreadCount : 0);
      setMuted(Array.isArray(data.muted) ? data.muted : []);
      setLoaded(true);
    } catch {
      // Stay quiet -- the bell just keeps showing what it last had.
    }
  }, []);

  // Poll while the tab is visible; refresh right away when it comes back.
  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleOpen = () => {
    setOpen((o) => !o);
    setShowSettings(false);
    if (!open) load();
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    setUnread(0);
    try {
      await authFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      });
    } catch {
      load();
    }
  };

  const openItem = async (item: NotificationItem) => {
    setOpen(false);
    if (!item.read_at) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)));
      setUnread((u) => Math.max(0, u - 1));
      authFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [item.id] }),
      }).catch(() => undefined);
    }
    if (item.link) router.push(item.link);
  };

  const toggleMuted = async (type: string) => {
    const next = muted.includes(type) ? muted.filter((t) => t !== type) : [...muted, type];
    setMuted(next);
    try {
      await authFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted: next }),
      });
    } catch {
      load();
    }
  };

  const badge = unread > 0 ? (unread > 99 ? '99+' : String(unread)) : null;

  const panelStyle =
    variant === 'sidebar'
      ? { left: `${(collapsed ? 5 : sidebarRem) + 0.75}rem` }
      : undefined;
  const panelClass =
    variant === 'sidebar'
      ? 'fixed bottom-4 z-[60] w-[22rem] max-w-[calc(100vw-2rem)]'
      : 'fixed left-2 right-2 top-14 z-[60]';

  return (
    <div ref={rootRef} className={variant === 'sidebar' ? 'w-full' : 'relative'}>
      {variant === 'sidebar' ? (
        <button
          type="button"
          onClick={toggleOpen}
          aria-label={badge ? `Notifications, ${unread} unread` : 'Notifications'}
          aria-expanded={open}
          title={collapsed ? 'Notifications' : undefined}
          className={`relative w-full flex items-center justify-center gap-2 text-slate-300 hover:bg-white/5 hover:text-slate-100 rounded-lg transition text-sm py-1.5 ${
            collapsed ? 'px-0' : 'px-4'
          }`}
        >
          <BellIcon className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Notifications</span>}
          {badge && (
            <span
              className={`min-w-[1.25rem] h-5 px-1.5 rounded-full bg-blue-500 text-white text-[11px] font-semibold flex items-center justify-center ${
                collapsed ? 'absolute -top-0.5 right-1' : ''
              }`}
            >
              {badge}
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={toggleOpen}
          aria-label={badge ? `Notifications, ${unread} unread` : 'Notifications'}
          aria-expanded={open}
          className="relative p-2.5 text-slate-300 hover:text-slate-100 hover:bg-slate-700 rounded-lg transition"
        >
          <BellIcon className="w-6 h-6" />
          {badge && (
            <span className="absolute top-1 right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-blue-500 text-white text-[10px] font-semibold flex items-center justify-center">
              {badge}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          style={panelStyle}
          className={`${panelClass} bg-slate-900 border border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <h2 className="text-sm font-semibold text-slate-100">{showSettings ? 'Notification settings' : 'Notifications'}</h2>
            <div className="flex items-center gap-3">
              {!showSettings && unread > 0 && (
                <button type="button" onClick={markAllRead} className="text-xs text-blue-400 hover:text-blue-300 font-medium transition">
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowSettings((s) => !s)}
                className="text-xs text-slate-400 hover:text-slate-200 font-medium transition"
              >
                {showSettings ? 'Back' : 'Settings'}
              </button>
            </div>
          </div>

          {showSettings ? (
            <div className="p-4 space-y-3 overflow-y-auto">
              <p className="text-xs text-slate-400">Choose what shows up in your bell. Turned-off types won&apos;t be saved for you.</p>
              {SETTINGS.map((s) => (
                <label key={s.type} className="flex items-center justify-between gap-3 text-sm text-slate-200 cursor-pointer">
                  <span>{s.label}</span>
                  <input
                    type="checkbox"
                    checked={!muted.includes(s.type)}
                    onChange={() => toggleMuted(s.type)}
                    className="w-4 h-4 accent-blue-500"
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="overflow-y-auto">
              {!loaded ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">Loading…</p>
              ) : items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  You&apos;re all caught up. New messages, completed steps and deadline changes show up here.
                </p>
              ) : (
                <ul className="divide-y divide-white/5">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openItem(n)}
                        className={`w-full text-left px-4 py-3 hover:bg-white/5 transition flex gap-3 ${n.read_at ? '' : 'bg-blue-500/10'}`}
                      >
                        <span
                          className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read_at ? 'bg-transparent' : 'bg-blue-400'}`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-slate-100 font-medium break-words">{n.title}</span>
                          {n.body && <span className="block text-xs text-slate-400 mt-0.5 break-words">{n.body}</span>}
                          <span className="block text-[11px] text-slate-500 mt-1">{timeAgo(n.created_at)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
