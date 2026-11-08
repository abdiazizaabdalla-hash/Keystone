'use client';

import MoneyInput from '@/components/MoneyInput';

// What a coordinator charges one agent, as a price list: the two standard fees stacked one on top of the other,
// then any other named charges underneath. Every amount is dollars (MoneyInput shows the $ sign).

export type PriceRow = { id: string; name: string; amount: string };

const input = 'w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

export default function AgentPriceList({
  transactionFee,
  listingFee,
  services,
  onTransactionFee,
  onListingFee,
  onServices,
}: {
  transactionFee: string;
  listingFee: string;
  services: PriceRow[];
  onTransactionFee: (v: string) => void;
  onListingFee: (v: string) => void;
  onServices: (rows: PriceRow[]) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm text-slate-300 block mb-1.5">Transaction coordination fee</label>
        <MoneyInput value={transactionFee} onValueChange={onTransactionFee} placeholder="400" aria-label="Transaction coordination fee" className={input} />
        <p className="text-xs text-slate-500 mt-1">Loads automatically when you invoice a transaction.</p>
      </div>
      <div>
        <label className="text-sm text-slate-300 block mb-1.5">Listing coordination fee</label>
        <MoneyInput value={listingFee} onValueChange={onListingFee} placeholder="250" aria-label="Listing coordination fee" className={input} />
        <p className="text-xs text-slate-500 mt-1">Loads automatically when you invoice a listing.</p>
      </div>
      {services.map((row, i) => (
        <div key={row.id}>
          <label className="text-sm text-slate-300 block mb-1.5">Other charge</label>
          <div className="flex gap-2">
            <input
              className={input}
              placeholder="Name, e.g. Rush file"
              maxLength={80}
              value={row.name}
              onChange={(e) => onServices(services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <div className="w-36 shrink-0">
              <MoneyInput value={row.amount} onValueChange={(v) => onServices(services.map((x, j) => (j === i ? { ...x, amount: v } : x)))} placeholder="0" aria-label={`${row.name || 'Other charge'} amount`} className={input} />
            </div>
            <button type="button" aria-label="Remove charge" onClick={() => onServices(services.filter((_, j) => j !== i))} className="px-2 text-slate-400 hover:text-red-300">
              ✕
            </button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onServices([...services, { id: Math.random().toString(36).slice(2, 10), name: '', amount: '' }])} className="text-sm text-blue-300 hover:text-blue-200">
        ＋ Add a charge
      </button>
      <p className="text-xs text-slate-500">Other charges show up in the Service list when you invoice this agent.</p>
    </div>
  );
}

/** Rows ready to send, or an error message when one is half filled in. */
export function cleanPriceRows(rows: PriceRow[]): { ok: true; services: { id: string; name: string; amount: number }[] } | { ok: false; error: string } {
  const filled = rows.filter((r) => r.name.trim() || r.amount.trim());
  if (filled.some((r) => !r.name.trim() || !Number.isFinite(parseFloat(r.amount)) || parseFloat(r.amount) < 0)) {
    return { ok: false, error: 'Give every other charge a name and a dollar amount.' };
  }
  return { ok: true, services: filled.map((r) => ({ id: r.id, name: r.name.trim(), amount: parseFloat(r.amount) })) };
}
