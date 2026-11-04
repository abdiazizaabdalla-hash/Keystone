'use client';

// Where an agent stands against their brokerage cap. Step 1 only shows it and warns; it never changes a split. The total is the
// brokerage's share on confirmed statements Relay holds, so deals from before the agent used Relay are not counted.

export interface CapView {
  capCents: number;
  reset: 'calendar_year' | 'anniversary';
  state: 'ok' | 'near' | 'reached' | 'unknown';
  periodStart: string | null;
  resetsOn: string | null;
  usedCents: number;
  remainingCents: number;
  percent: number;
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function CapNotice({ cap, who }: { cap: CapView; who: 'owner' | 'agent' }) {
  const tone = cap.state === 'reached' ? 'border-red-500/40 bg-red-500/10 text-red-200' : cap.state === 'near' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-white/10 bg-white/5 text-slate-300';
  const bar = cap.state === 'reached' ? 'bg-red-400' : cap.state === 'near' ? 'bg-amber-400' : 'bg-blue-400';
  const subject = who === 'agent' ? 'You have' : 'This agent has';
  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${tone}`}>
      {cap.state === 'unknown' ? (
        <p>A {usd(cap.capCents)} cap is set, but there is no anniversary date to count it from. Set the cap start date to track it.</p>
      ) : (
        <>
          <p className="font-medium">
            {cap.state === 'reached' ? `${subject} reached the ${usd(cap.capCents)} cap` : cap.state === 'near' ? `${subject} used ${cap.percent}% of the ${usd(cap.capCents)} cap` : `Cap: ${usd(cap.usedCents)} of ${usd(cap.capCents)} used`}
            {cap.resetsOn ? ` · resets ${cap.resetsOn}` : ''}
          </p>
          <div className="h-1.5 rounded-full bg-black/30 mt-1.5 overflow-hidden" role="progressbar" aria-valuenow={cap.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Cap used">
            <div className={`h-full ${bar}`} style={{ width: `${cap.percent}%` }} />
          </div>
          <p className="mt-1 opacity-80">Counts the brokerage’s share on confirmed statements in Relay. Deals from before Relay are not included, and this does not change any split.</p>
        </>
      )}
    </div>
  );
}
