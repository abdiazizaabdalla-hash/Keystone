'use client';

// Where a deal's transaction coordinator stands for the agent who invited them: invited and waiting, or accepted.
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null);

export default function CoordinatorStatus({ accepted, pending, compact = false }: { accepted: { email: string; addedAt: string } | null; pending: { email: string; createdAt: string } | null; compact?: boolean }) {
  if (!accepted && !pending) return null;
  const ok = !!accepted;
  const email = accepted?.email ?? pending?.email ?? '';
  const date = ok ? when(accepted?.addedAt) : when(pending?.createdAt);
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`} role="status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span className="text-sm font-medium text-slate-100 truncate">{email}</span>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${ok ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300'}`}>{ok ? 'Accepted' : 'Invited · not accepted yet'}</span>
      </div>
      <p className="text-xs text-slate-400 mt-1.5">
        {ok ? `Your transaction coordinator${date ? ` joined on ${date}` : ' has joined'}.${compact ? '' : ' You can message them here.'}` : `Invitation sent${date ? ` on ${date}` : ''}. They accept from their Relay TC account, and then you can message each other here.`}
      </p>
    </div>
  );
}
