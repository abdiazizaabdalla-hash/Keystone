// Fees saved on an agent's profile, as lines a coordinator can drop onto any invoice.

export interface FeeAgent {
  id: string;
  name: string;
  email: string | null;
  flat_fee?: number | string | null;
  listing_fee?: number | string | null;
  services?: Array<{ id: string; name: string; amount: number }> | null;
}

/** The fees saved on an agent, as lines a coordinator can drop onto any invoice. Zero or empty fees are left out. */
export function agentFeeOptions(a: FeeAgent): Array<{ key: string; label: string; amount: number }> {
  const out: Array<{ key: string; label: string; amount: number }> = [];
  const tx = Number(a.flat_fee);
  if (tx > 0) out.push({ key: 'transaction', label: 'Transaction coordination fee', amount: tx });
  const ls = Number(a.listing_fee);
  if (ls > 0) out.push({ key: 'listing', label: 'Listing coordination fee', amount: ls });
  for (const s of a.services || []) if (Number(s.amount) > 0) out.push({ key: `svc-${s.id}`, label: s.name, amount: Number(s.amount) });
  return out;
}

