'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { US_STATES } from '@/lib/usStates';
import { STATE_FORM_INFO, TIER_LABEL, formSourcesFor } from '@/lib/stateFormSources';

// On a deal's Documents tab: the documents for the state the property is in (from its address, or the state chosen on
// the Overview tab). Shows the person's own forms and letters for that state, a place to add their brokerage's IABS,
// and the recommended official forms. Relay keeps no copy of official forms; each link opens the source's own page.

export interface DealTemplate {
  id: string;
  kind: 'email' | 'letter' | 'form';
  name: string;
  description: string | null;
  states: string[];
}

interface TrecForm {
  slug: string;
  name: string;
  formId: string;
  url: string;
  effectiveDate: string | null;
}

// The Texas forms most deals need, in the order they usually come up. Matched on the name TREC publishes.
const TREC_RECOMMENDED: { match: RegExp; why: string }[] = [
  { match: /one to four family residential contract \(resale\)/i, why: 'The resale contract' },
  { match: /third party financing addendum/i, why: 'When the buyer is financing' },
  { match: /seller.?s disclosure notice/i, why: 'Seller discloses known conditions' },
  { match: /addendum for property subject to mandatory membership/i, why: 'Property in an HOA' },
  { match: /addendum for seller.?s disclosure of information on lead-based paint/i, why: 'Homes built before 1978' },
  { match: /addendum for sale of other property/i, why: 'Buyer must sell first' },
  { match: /^amendment to contract/i, why: 'Changing the contract after signing' },
  { match: /termination of contract/i, why: 'Ending the contract' },
];

const IABS_RE = /iabs|information about brokerage|agency disclosure|consumer notice/i;
const card = 'bg-slate-800/40 border border-white/10 rounded-xl p-4';

export default function DealStateDocs({ dealState, onUse }: { dealState: string | null; onUse: (t: DealTemplate) => void }) {
  const [mine, setMine] = useState<DealTemplate[] | null>(null);
  const [trec, setTrec] = useState<TrecForm[]>([]);

  useEffect(() => {
    if (!dealState) return;
    let cancelled = false;
    (async () => {
      try {
        const [res, trecRes] = await Promise.all([
          authFetch(`/api/templates?kinds=letter,form&state=${dealState}`),
          dealState === 'TX' ? authFetch('/api/templates/trec') : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setMine(res.ok ? ((await res.json()) as DealTemplate[]) : []);
        if (trecRes && trecRes.ok) setTrec(((await trecRes.json()) as { forms: TrecForm[] }).forms ?? []);
      } catch {
        if (!cancelled) setMine([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealState]);

  if (!dealState) {
    return (
      <div className={`${card} mt-4`}>
        <p className="text-sm text-slate-300">Add the property address, or choose the state on the Overview tab, to see the forms and templates for that state here.</p>
      </div>
    );
  }

  const stateName = US_STATES.find((s) => s.code === dealState)?.name ?? dealState;
  const info = STATE_FORM_INFO[dealState];
  const stateOnly = (mine ?? []).filter((t) => t.states.includes(dealState));
  const allState = (mine ?? []).filter((t) => t.states.length === 0);
  const hasIabs = (mine ?? []).some((t) => t.kind === 'form' && IABS_RE.test(t.name));
  const trecPicks = TREC_RECOMMENDED.flatMap((r) => trec.filter((f) => r.match.test(f.name)).map((form) => ({ r, form })));
  const sources = formSourcesFor(dealState);

  const chip = (t: DealTemplate) => (
    <button
      key={t.id}
      type="button"
      onClick={() => onUse(t)}
      className="max-w-full inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-sm text-slate-100 transition"
      title={t.description || `Add “${t.name}” to this deal`}
    >
      <span className="truncate">{t.name}</span>
      <span className="text-[10px] uppercase tracking-wide text-blue-300 shrink-0">{t.kind === 'form' ? 'Form' : 'Letter'}</span>
    </button>
  );

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{stateName} documents for this deal</p>
        <p className="text-xs text-slate-500">Chosen from the property address ({dealState}). You can change the state on the Overview tab.</p>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold text-slate-100 mb-2">Your {stateName} forms and letters</p>
        {mine === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : stateOnly.length === 0 ? (
          <p className="text-sm text-slate-400">
            You haven&rsquo;t added any forms for {stateName} yet. <Link href="/dashboard/templates" className="text-blue-400 hover:text-blue-300">Add yours in Templates</Link>.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">{stateOnly.map(chip)}</div>
        )}
        {allState.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-slate-500 mb-1.5">For every state</p>
            <div className="flex flex-wrap gap-2">{allState.map(chip)}</div>
          </div>
        )}
        {!hasIabs && (
          <Link
            href="/dashboard/templates?upload=iabs"
            className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-600 hover:border-blue-500 px-3 py-2.5 text-sm text-slate-300 hover:text-blue-300 transition"
          >
            <span>Add your brokerage&rsquo;s IABS{dealState === 'TX' ? ' (Information About Brokerage Services)' : ' or agency disclosure'}</span>
            <span className="text-xs text-slate-500">Upload once, use on every {stateName} deal</span>
          </Link>
        )}
      </div>

      <div className={card}>
        <p className="text-sm font-semibold text-slate-100 mb-0.5">Recommended for a {stateName} deal</p>
        {dealState === 'TX' && trecPicks.length > 0 ? (
          <>
            <p className="text-xs text-slate-500 mb-2">Official Texas Real Estate Commission forms. These open on trec.texas.gov so you always get the current version.</p>
            <ul className="divide-y divide-white/5">
              {trecPicks.map(({ r, form }) => (
                <li key={form.slug}>
                  <a href={form.url} target="_blank" rel="noreferrer" className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm hover:bg-white/5 -mx-2 px-2 rounded-lg transition">
                    <span className="text-slate-100">{form.name}</span>
                    <span className="text-xs text-slate-500">{form.formId}</span>
                    <span className="text-xs text-slate-400 ml-auto">{r.why} ↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : info ? (
          <>
            <p className="text-xs text-slate-500 mb-2">
              {TIER_LABEL[info.tier]}. {info.summary}
            </p>
            {sources.length === 0 ? (
              <p className="text-sm text-slate-400">We could not confirm a public source of forms for {stateName}. Use the forms your brokerage or association gives you.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {sources.map((s) => (
                  <li key={s.id}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="block py-2 text-sm hover:bg-white/5 -mx-2 px-2 rounded-lg transition">
                      <span className="text-slate-100">{s.label} ↗</span>
                      <span className="block text-xs text-slate-400">{s.covers}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-400">We have not checked official sources for {stateName} yet.</p>
        )}
      </div>
    </div>
  );
}
