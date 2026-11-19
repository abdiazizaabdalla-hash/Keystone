'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { NOTIFICATIONS_EVENT, TOAST_EVENT, showToast, type ToastInput } from '@/lib/toast';

interface Live extends ToastInput {
  key: number;
  shown: boolean;
}

interface BellItem {
  id: string;
  event_type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
}

// The notifications that deserve a banner the moment they arrive, not only a number on the bell.
const BIG_TYPES = new Set(['invoice', 'deal_closed', 'commission', 'invite']);

function bannerFor(n: BellItem): ToastInput {
  const text = n.title || '';
  const good = n.event_type === 'deal_closed' || /was paid/i.test(text);
  const bad = /refund/i.test(text);
  return {
    title: text,
    body: n.body || undefined,
    tone: bad ? 'warning' : good ? 'success' : 'info',
    href: n.link || undefined,
    actionLabel: n.link ? 'View' : undefined,
    durationMs: 10_000,
  };
}

const TONE: Record<string, { ring: string; dot: string; icon: string }> = {
  success: { ring: 'border-emerald-400/50 bg-emerald-950/95', dot: 'bg-emerald-400', icon: '✓' },
  info: { ring: 'border-blue-400/50 bg-slate-900/95', dot: 'bg-blue-400', icon: 'i' },
  warning: { ring: 'border-amber-400/50 bg-amber-950/95', dot: 'bg-amber-400', icon: '!' },
};

export default function ToastHost() {
  const router = useRouter();
  const pathname = usePathname();
  const [toasts, setToasts] = useState<Live[]>([]);
  const counter = useRef(0);
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((key: number) => {
    const t = timers.current.get(key);
    if (t) clearTimeout(t);
    timers.current.delete(key);
    setToasts((list) => list.filter((x) => x.key !== key));
  }, []);

  const arm = useCallback(
    (key: number, ms: number) => {
      const old = timers.current.get(key);
      if (old) clearTimeout(old);
      timers.current.set(key, setTimeout(() => dismiss(key), ms));
    },
    [dismiss]
  );

  const add = useCallback(
    (input: ToastInput) => {
      const key = ++counter.current;
      const duration = input.durationMs ?? 7000;
      setToasts((list) => [...list.slice(-2), { ...input, key, shown: false }]);
      requestAnimationFrame(() => setToasts((list) => list.map((x) => (x.key === key ? { ...x, shown: true } : x))));
      arm(key, duration);
    },
    [arm]
  );

  useEffect(() => {
    const onToast = (e: Event) => add((e as CustomEvent<ToastInput>).detail);
    const onNotifications = (e: Event) => {
      const items = ((e as CustomEvent<BellItem[]>).detail || []) as BellItem[];
      // The first batch is just what was already waiting; only later arrivals get a banner.
      if (seen.current === null) {
        seen.current = new Set(items.map((i) => i.id));
        return;
      }
      for (const n of items) {
        if (seen.current.has(n.id)) continue;
        seen.current.add(n.id);
        if (!n.read_at && BIG_TYPES.has(n.event_type)) add(bannerFor(n));
      }
    };
    window.addEventListener(TOAST_EVENT, onToast);
    window.addEventListener(NOTIFICATIONS_EVENT, onNotifications);
    const live = timers.current;
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      window.removeEventListener(NOTIFICATIONS_EVENT, onNotifications);
      live.forEach((t) => clearTimeout(t));
      live.clear();
    };
  }, [add]);

  // Stripe sends people back to the page they started from with ?stripe=connected (or error / refresh).
  useEffect(() => {
    if (pathname.startsWith('/dashboard/settings') || pathname.startsWith('/onboarding')) return;
    const url = new URL(window.location.href);
    const state = url.searchParams.get('stripe');
    if (!state) return;
    url.searchParams.delete('stripe');
    router.replace(`${url.pathname}${url.search}`);
    if (state === 'connected') {
      showToast({ title: 'Stripe is connected', body: 'Payments on your invoices now go to your Stripe account. You can close this tab if you opened it from another page.', tone: 'success', durationMs: 12_000 });
    } else {
      showToast({ title: 'Stripe setup is not finished', body: 'Choose Connect Stripe to pick up where you left off.', tone: 'warning', durationMs: 10_000 });
    }
  }, [pathname, router]);

  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3" aria-live="polite">
      {toasts.map((t) => {
        const tone = TONE[t.tone || 'info'];
        return (
          <div
            key={t.key}
            role="status"
            onMouseEnter={() => {
              const old = timers.current.get(t.key);
              if (old) clearTimeout(old);
            }}
            onMouseLeave={() => arm(t.key, 3000)}
            className={`pointer-events-auto w-full max-w-xl rounded-2xl border px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur transition-all duration-300 ${tone.ring} ${t.shown ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'}`}
          >
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-slate-950 ${tone.dot}`}>{tone.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-50">{t.title}</p>
                {t.body && <p className="mt-0.5 text-sm text-slate-300">{t.body}</p>}
                {t.href && (
                  <button
                    type="button"
                    onClick={() => {
                      router.push(t.href as string);
                      dismiss(t.key);
                    }}
                    className="mt-2 rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-white/20"
                  >
                    {t.actionLabel || 'View'}
                  </button>
                )}
              </div>
              <button type="button" onClick={() => dismiss(t.key)} aria-label="Dismiss" className="shrink-0 text-slate-400 hover:text-slate-100">
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
