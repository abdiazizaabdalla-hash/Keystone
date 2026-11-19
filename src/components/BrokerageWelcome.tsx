'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// The first-run tour for a brokerage owner. It works like the coordinator tour: a welcome, then one topic at a time on the real
// screen with a small card to guide you, then back to a short list of what is left, until everything has been covered.
// The person picks the order; whatever they have not picked yet is offered again, so nothing is missed.
interface Topic { id: string; href: string; path: RegExp; title: string; blurb: string; look: string[] }

const TOPICS: Topic[] = [
  { id: 'agents', href: '/dashboard/collaborate', path: /^\/dashboard\/collaborate/, title: 'Invite your agents', blurb: 'Each agent gets a free Relay workspace while on your roster.',
    look: ['Add an agent by email. They get an invitation, and nothing is shared with you until they accept.', 'See who has joined and who is still pending.', 'Your plan sets how many agents are included.'] },
  { id: 'compliance', href: '/dashboard/compliance', path: /^\/dashboard\/compliance/, title: 'Open the compliance desk', blurb: 'See which files are missing required documents or about to close.',
    look: ['Files missing a required document are flagged.', 'Choose which documents every file must contain.', 'Mark a file reviewed to keep your own record.'] },
  { id: 'automations', href: '/dashboard/automations', path: /^\/dashboard\/automations/, title: 'Check your office automations', blurb: 'Alerts and a daily digest that run on their own.',
    look: ['Switch each automation on or off.', 'Adjust how many days before an alert goes out.', 'Recent runs show what each one found.'] },
  { id: 'reports', href: '/dashboard/reports', path: /^\/dashboard\/reports/, title: 'See your reports', blurb: 'Production by agent and month, and trends across your office.',
    look: ['Compare agents and months.', 'Watch trends across your office.', 'Download an export to share.'] },
];

const KEY = 'relay_brokerage_tour_done';
const readDone = (): string[] => {
  try { const v = JSON.parse(window.localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
};
const writeDone = (ids: string[]) => { try { window.localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* the tour just forgets its place */ } };

/** Forget the tour's place (used when the Tutorial menu restarts it). */
export function resetBrokerageTour() { try { window.localStorage.removeItem(KEY); } catch { /* ignore */ } }

export default function BrokerageWelcome({ onClose }: { onClose: (done: boolean) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [done, setDone] = useState<string[]>(() => (typeof window === 'undefined' ? [] : readDone()));
  const [active, setActive] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const left = TOPICS.filter((t) => !done.includes(t.id));
  const topic = TOPICS.find((t) => t.id === active) ?? null;

  const begin = (t: Topic) => { setActive(t.id); setStarted(true); router.push(t.href); };
  const complete = () => {
    if (!topic) return;
    const next = [...new Set([...done, topic.id])];
    setDone(next);
    writeDone(next);
    setActive(null);
  };

  // A topic's small guide card, kept on screen while the real page is open.
  if (topic) {
    const onPage = topic.path.test(pathname ?? '');
    const n = Math.min(done.length + 1, TOPICS.length);
    return (
      <aside className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] sm:w-96 bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl p-4" aria-label="Brokerage tour">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold tracking-wider text-blue-400 uppercase">Tour · {n} of {TOPICS.length}</p>
          <button type="button" onClick={() => setActive(null)} className="text-xs text-slate-400 hover:text-slate-200">Back to the list</button>
        </div>
        <div className="h-1 rounded-full bg-white/10 mb-3"><div className="h-1 rounded-full bg-blue-500" style={{ width: `${(done.length / TOPICS.length) * 100}%` }} /></div>
        <p className="font-semibold text-slate-100 mb-1">{topic.title}</p>
        {onPage ? (
          <>
            <p className="text-xs text-slate-400 mb-2">What to look for on this screen:</p>
            <ul className="space-y-1.5 mb-4 text-sm text-slate-200 list-disc pl-5">{topic.look.map((l) => <li key={l}>{l}</li>)}</ul>
            <div className="flex items-center gap-3">
              <button type="button" onClick={complete} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">Got it{left.length > 1 ? ', what is next?' : ''}</button>
              <button type="button" onClick={() => setActive(null)} className="text-sm text-slate-400 hover:text-slate-200">Not now</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-300 mb-3">Tutorial paused. Pick up where you left off: {topic.title.toLowerCase()}.</p>
            <button type="button" onClick={() => router.push(topic.href)} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">Take me back</button>
          </>
        )}
      </aside>
    );
  }

  // The list: the welcome the first time, then "what next" with whatever is left.
  const finished = left.length === 0;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="brokerage-welcome-title">
      <div className="w-full max-w-lg bg-slate-800 border border-slate-600 rounded-2xl p-6 shadow-2xl">
        <h2 id="brokerage-welcome-title" className="text-xl font-display font-semibold text-slate-100 mb-1">
          {finished ? 'You have been through everything' : started || done.length > 0 ? 'What would you like to see next?' : 'Welcome to your brokerage on Relay'}
        </h2>
        <p className="text-sm text-slate-300 mb-4">
          {finished ? 'Your agents do the deals and you see where every file stands. You can bring this tour back any time from “Tutorial” in the menu.'
            : started || done.length > 0 ? `${done.length} of ${TOPICS.length} done. Pick what is left, in any order.`
            : 'Your agents do the deals. You see where every file stands. We will take you through four things, one at a time, in any order you like.'}
        </p>
        {!finished && (
          <ul className="space-y-2 mb-5">
            {TOPICS.map((t) => {
              const isDone = done.includes(t.id);
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => begin(t)} className={`w-full text-left rounded-xl border px-4 py-3 transition ${isDone ? 'border-emerald-500/30 bg-emerald-500/5 opacity-70' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
                    <span className="block font-semibold text-slate-100">{isDone ? '✓ ' : ''}{t.title}</span>
                    <span className="block text-sm text-slate-400 mt-0.5">{t.blurb}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center justify-between">
          {finished
            ? <span />
            : <button type="button" onClick={() => onClose(false)} className="text-sm text-slate-400 hover:text-slate-200 transition">Maybe later</button>}
          <button type="button" onClick={() => onClose(true)} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">
            {finished ? 'Finish' : 'I’ll explore on my own'}
          </button>
        </div>
      </div>
    </div>
  );
}
