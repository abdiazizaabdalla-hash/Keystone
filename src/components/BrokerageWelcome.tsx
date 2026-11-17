'use client';

import Link from 'next/link';

// The first-visit welcome for a brokerage owner. A brokerage does not file deals itself, so it gets a short list of where to start
// instead of the coordinator tour (add your agent, start a deal).
const STARTS: { href: string; title: string; body: string }[] = [
  { href: '/dashboard/collaborate', title: 'Invite your agents', body: 'Each agent gets a free Relay workspace while on your roster. Nothing is shared with you until they accept.' },
  { href: '/dashboard/compliance', title: 'Open the compliance desk', body: 'See which files are missing required documents, which are about to close, and review what is on file.' },
  { href: '/dashboard/automations', title: 'Check your office automations', body: 'Stalled-deal alerts, closing deadlines, missing documents and a daily digest, running on their own.' },
  { href: '/dashboard/reports', title: 'See your reports', body: 'Production by agent and month, trends across your office, and exports you can download.' },
];

export default function BrokerageWelcome({ onClose }: { onClose: (done: boolean) => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="brokerage-welcome-title">
      <div className="w-full max-w-lg bg-slate-800 border border-slate-600 rounded-2xl p-6 shadow-2xl">
        <h2 id="brokerage-welcome-title" className="text-xl font-display font-semibold text-slate-100 mb-1">Welcome to your brokerage on Relay</h2>
        <p className="text-sm text-slate-300 mb-4">Your agents do the deals. You see where every file stands. Here is where to start.</p>
        <ul className="space-y-2 mb-5">
          {STARTS.map((s) => (
            <li key={s.href}>
              <Link href={s.href} onClick={() => onClose(true)} className="block rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3 transition">
                <span className="block font-semibold text-slate-100">{s.title}</span>
                <span className="block text-sm text-slate-400 mt-0.5">{s.body}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => onClose(false)} className="text-sm text-slate-400 hover:text-slate-200 transition">Maybe later</button>
          <button type="button" onClick={() => onClose(true)} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">I’ll explore on my own</button>
        </div>
        <p className="text-xs text-slate-500 mt-4 text-center">You can bring this back any time from “Tutorial” in the menu.</p>
      </div>
    </div>
  );
}
