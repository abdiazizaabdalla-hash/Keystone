// The agent's other billable services (name + price). Only written when the page sent a list, so saving an agent never
// touches a column that does not exist yet. Bad rows are dropped rather than rejected.
export type AgentService = { id: string; name: string; amount: number };
export function cleanServices(value: unknown): AgentService[] {
  if (!Array.isArray(value)) return [];
  const out: AgentService[] = [];
  for (const raw of value.slice(0, 40)) {
    const r = (raw || {}) as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '';
    const amount = Number(r.amount);
    if (!name || !Number.isFinite(amount) || amount < 0 || amount > 10_000_000) continue;
    const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 40) : Math.random().toString(36).slice(2, 10);
    out.push({ id, name, amount: Math.round(amount * 100) / 100 });
  }
  return out;
}
