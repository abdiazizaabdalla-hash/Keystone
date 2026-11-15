import { CLOSED_STAGE, type OversightDeal, type DealHealth } from './oversightMath';

// Deal-level reports for a brokerage owner: choose the columns and filters, see the rows, download a CSV. Pure (no database).
// Nothing private to the agent is available here: no client names, fees or messages.

export type ReportDeal = OversightDeal & { health: DealHealth; tasksTotal: number; tasksDone: number };

export interface ReportContext {
  agentName: string;
  agentEmail: string;
  /** Required documents still missing; null when the column was not asked for. */
  missing: string[] | null;
}

export const REPORT_COLUMNS = [
  { id: 'address', label: 'Property' },
  { id: 'fileNumber', label: 'File number' },
  { id: 'agent', label: 'Agent' },
  { id: 'agentEmail', label: 'Agent email' },
  { id: 'status', label: 'Stage' },
  { id: 'price', label: 'Purchase price' },
  { id: 'acceptance', label: 'Acceptance date' },
  { id: 'closing', label: 'Closing date' },
  { id: 'daysToClose', label: 'Days to close' },
  { id: 'checklist', label: 'Checklist done' },
  { id: 'overdue', label: 'Overdue steps' },
  { id: 'nextDue', label: 'Next step due' },
  { id: 'template', label: 'Checklist template' },
  { id: 'missing', label: 'Missing required documents' },
] as const;

export type ReportColumnId = (typeof REPORT_COLUMNS)[number]['id'];
export const DEFAULT_REPORT_COLUMNS: ReportColumnId[] = ['address', 'agent', 'status', 'price', 'closing', 'checklist', 'overdue'];

export function cleanColumns(input: unknown): ReportColumnId[] {
  const wanted = new Set(typeof input === 'string' ? input.split(',') : Array.isArray(input) ? input : []);
  const picked = REPORT_COLUMNS.map((c) => c.id).filter((id) => wanted.has(id));
  return picked.length ? picked : DEFAULT_REPORT_COLUMNS;
}

export type ReportScope = 'all' | 'open' | 'closed';

export interface ReportFilters {
  agentIds?: string[];
  scope?: ReportScope;
  stages?: string[];
  /** Closing date range, YYYY-MM-DD, inclusive. A deal without a closing date is left out when either end is set. */
  from?: string | null;
  to?: string | null;
}

const isoDay = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function cleanFilters(q: { agents?: string | null; scope?: string | null; stages?: string | null; from?: string | null; to?: string | null }): ReportFilters {
  return {
    agentIds: q.agents ? q.agents.split(',').filter(Boolean).slice(0, 200) : [],
    scope: q.scope === 'open' || q.scope === 'closed' ? q.scope : 'all',
    stages: q.stages ? q.stages.split(',').filter(Boolean).slice(0, 30) : [],
    from: isoDay(q.from),
    to: isoDay(q.to),
  };
}

export function filterDeals<T extends ReportDeal>(deals: T[], f: ReportFilters): T[] {
  return deals.filter((d) => {
    if (f.agentIds?.length && !f.agentIds.includes(d.tc_user_id)) return false;
    if (f.scope === 'open' && d.status === CLOSED_STAGE) return false;
    if (f.scope === 'closed' && d.status !== CLOSED_STAGE) return false;
    if (f.stages?.length && !f.stages.includes(d.status ?? '')) return false;
    if (f.from || f.to) {
      const c = (d.closing_date ?? '').slice(0, 10);
      if (!c) return false;
      if (f.from && c < f.from) return false;
      if (f.to && c > f.to) return false;
    }
    return true;
  });
}

const price = (v: number | string | null | undefined) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : '';
};

function daysBetween(a: string, b: string): number | '' {
  const x = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const y = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(x) || Number.isNaN(y) ? '' : Math.round((y - x) / 86400000);
}

export function cellFor(col: ReportColumnId, d: ReportDeal, ctx: ReportContext): string | number {
  switch (col) {
    case 'address': return d.property_address ?? '';
    case 'fileNumber': return d.file_number ?? '';
    case 'agent': return ctx.agentName;
    case 'agentEmail': return ctx.agentEmail;
    case 'status': return d.status ?? '';
    case 'price': return price(d.purchase_price);
    case 'acceptance': return (d.acceptance_date ?? '').slice(0, 10);
    case 'closing': return (d.closing_date ?? '').slice(0, 10);
    case 'daysToClose': return d.acceptance_date && d.closing_date ? daysBetween(d.acceptance_date, d.closing_date) : '';
    case 'checklist': return d.tasksTotal ? `${d.tasksDone}/${d.tasksTotal}` : '';
    case 'overdue': return d.status === CLOSED_STAGE ? '' : d.health.overdueTasks;
    case 'nextDue': return d.health.nextDue ?? '';
    case 'template': return d.checklist_template_name ?? '';
    case 'missing': return ctx.missing ? ctx.missing.join('; ') : '';
  }
}

export function buildReport(deals: ReportDeal[], columns: ReportColumnId[], contextFor: (d: ReportDeal) => ReportContext): { head: { id: ReportColumnId; label: string }[]; rows: (string | number)[][] } {
  const head = columns.map((id) => ({ id, label: REPORT_COLUMNS.find((c) => c.id === id)!.label }));
  const rows = deals.map((d) => {
    const ctx = contextFor(d);
    return columns.map((c) => cellFor(c, d, ctx));
  });
  return { head, rows };
}
