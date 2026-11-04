// Commission split arithmetic. Pure (no database), all in whole cents so nothing drifts by a fraction of a cent.
//
// A split says how the gross commission on a deal is divided between the agent and the brokerage:
//   percent          the agent keeps `value` percent (0 to 100)
//   flat_agent       the agent gets a fixed `value` dollars
//   flat_brokerage   the brokerage takes a fixed `value` dollars (the agent keeps the rest)
// Deductions (transaction fee, E&O, desk fee...) are charged to the agent and paid to the brokerage, on top of the split.

export type SplitType = 'percent' | 'flat_agent' | 'flat_brokerage';
export const SPLIT_TYPES: SplitType[] = ['percent', 'flat_agent', 'flat_brokerage'];
export const isSplitType = (v: unknown): v is SplitType => typeof v === 'string' && (SPLIT_TYPES as string[]).includes(v);

export interface Deduction {
  label: string;
  amount: number; // dollars
}

export interface SplitInput {
  gross: number; // dollars
  splitType: SplitType;
  splitValue: number; // percent, or dollars
  deductions?: Deduction[];
}

export interface SplitResult {
  grossCents: number;
  agentShareCents: number; // before deductions
  brokerageShareCents: number; // before deductions
  deductionsCents: number;
  agentNetCents: number;
  brokerageNetCents: number;
  agentPercentOfGross: number;
}

export class SplitError extends Error {}

export const toCents = (dollars: number): number => Math.round((dollars + Number.EPSILON) * 100);
export const fromCents = (cents: number): number => cents / 100;

export function computeSplit(input: SplitInput): SplitResult {
  const { gross, splitType, splitValue } = input;
  if (!Number.isFinite(gross) || gross <= 0) throw new SplitError('Enter the gross commission as an amount above zero.');
  if (gross > 100_000_000) throw new SplitError('That gross commission is too large.');
  if (!isSplitType(splitType)) throw new SplitError('Choose how the commission is split.');
  if (!Number.isFinite(splitValue) || splitValue < 0) throw new SplitError('The split value cannot be negative.');
  const grossCents = toCents(gross);

  let agentShareCents: number;
  if (splitType === 'percent') {
    if (splitValue > 100) throw new SplitError('A percentage split cannot be above 100%.');
    agentShareCents = Math.round((grossCents * splitValue) / 100);
  } else {
    const flatCents = toCents(splitValue);
    if (flatCents > grossCents) throw new SplitError('A fixed amount cannot be more than the gross commission.');
    agentShareCents = splitType === 'flat_agent' ? flatCents : grossCents - flatCents;
  }
  const brokerageShareCents = grossCents - agentShareCents;

  let deductionsCents = 0;
  for (const d of input.deductions ?? []) {
    if (!Number.isFinite(d.amount) || d.amount < 0) throw new SplitError('Fees cannot be negative.');
    deductionsCents += toCents(d.amount);
  }
  if (deductionsCents > agentShareCents) throw new SplitError('The fees are more than the agent’s share.');

  return {
    grossCents,
    agentShareCents,
    brokerageShareCents,
    deductionsCents,
    agentNetCents: agentShareCents - deductionsCents,
    brokerageNetCents: brokerageShareCents + deductionsCents,
    agentPercentOfGross: Math.round((agentShareCents / grossCents) * 10000) / 100,
  };
}

/** Clean a list of fees from user input: trimmed labels, finite non-negative amounts, at most 10, blanks dropped. */
export function cleanDeductions(value: unknown): Deduction[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SplitError('Fees must be a list.');
  const out: Deduction[] = [];
  for (const raw of value) {
    const r = raw as { label?: unknown; amount?: unknown };
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 60) : '';
    const amount = typeof r.amount === 'number' ? r.amount : typeof r.amount === 'string' && r.amount.trim() !== '' ? Number(r.amount) : 0;
    if (!label && !amount) continue;
    if (!label) throw new SplitError('Give each fee a name.');
    if (!Number.isFinite(amount) || amount < 0) throw new SplitError('Fees cannot be negative.');
    out.push({ label, amount: fromCents(toCents(amount)) });
  }
  if (out.length > 10) throw new SplitError('No more than 10 fees on a deal.');
  return out;
}

export const splitLabel = (type: SplitType, value: number): string =>
  type === 'percent' ? `Agent keeps ${value}%` : type === 'flat_agent' ? `Agent gets $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `Brokerage fee $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A fee in an agent's base terms, copied onto each new statement. `when` says where it comes out; today every fee comes out of
 * the agent's share (the only kind the split math supports). It is stored so a fee taken off the top (a franchise royalty) can
 * be added later without changing what is already saved.
 */
export interface BaseFee extends Deduction {
  when: 'agent_share';
}

export function cleanBaseFees(value: unknown): BaseFee[] {
  return cleanDeductions(value).map((d) => ({ ...d, when: 'agent_share' as const }));
}
