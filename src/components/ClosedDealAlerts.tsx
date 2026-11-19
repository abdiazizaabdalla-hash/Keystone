'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';

interface Alert {
  id: string;
  title: string;
  link: string | null;
}

/**
 * Unread "deal closed by the other party" notifications, shown as green cards at the top of the dashboard so a closing
 * can't slip by in the bell. Dismissing one marks it read.
 */
export default function ClosedDealAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/notifications');
        if (!res.ok) return;
        const data = await res.json();
        const rows = Array.isArray(data.notifications) ? data.notifications : [];
        setAlerts(rows.filter((n: { event_type: string; read_at: string | null; title: string; link: string | null; id: string }) => n.event_type === 'deal_closed' && !n.read_at && /closed by/i.test(n.title)).map((n: Alert) => ({ id: n.id, title: n.title, link: n.link })));
      } catch {
        // The bell still has it.
      }
    })();
  }, []);

  const dismiss = async (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    try {
      await authFetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) });
    } catch {
      // It will show again next visit.
    }
  };

  if (alerts.length === 0) return null;
  return (
    <div className="mb-6 space-y-2" aria-label="Closed deals">
      {alerts.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-400/50 bg-emerald-500/15 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-100"><span aria-hidden>✓ </span>{a.title}</p>
          <div className="flex items-center gap-3">
            {a.link && <Link href={a.link} onClick={() => void dismiss(a.id)} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold rounded-xl transition">Open deal</Link>}
            <button type="button" onClick={() => void dismiss(a.id)} className="text-sm text-emerald-200/80 hover:text-emerald-100">Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
