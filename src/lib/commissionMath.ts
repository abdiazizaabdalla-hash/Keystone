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
  /** Set when the agent added this line to their own invoice (the brokerage's own fees carry no mark). */
  by?: 'agent';
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
    const r = raw as { label?: unknown; amount?: unknown; by?: unknown };
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 60) : '';
    const amount = typeof r.amount === 'number' ? r.amount : typeof r.amount === 'string' && r.amount.trim() !== '' ? Number(r.amount) : 0;
    if (!label && !amount) continue;
    if (!label) throw new SplitError('Give each fee a name.');
    if (!Number.isFinite(amount) || amount < 0) throw new SplitError('Fees cannot be negative.');
    out.push({ label, amount: fromCents(toCents(amount)), ...(r.by === 'agent' ? { by: 'agent' as const } : {}) });
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
  return cleanDeductions(value).map((d) => ({ label: d.label, amount: d.amount, when: 'agent_share' as const }));
}

/**
 * The brokerage's commission on a deal: a percentage of the sale price, or a flat fee. Commission is negotiable and is not
 * always a percentage, so both are supported. Nothing is assumed: with no rate set there is no expected amount.
 */
export type CommissionRateType = 'percent' | 'flat';
export interface CommissionRate { type: CommissionRateType; value: number }
export const isRateType = (v: unknown): v is CommissionRateType => v === 'percent' || v === 'flat';

/** Checks a rate from user input (percent 0 to 100 with up to 3 decimals, or a flat amount of zero or more). */
export function cleanRate(type: unknown, value: unknown): CommissionRate {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!isRateType(type)) throw new SplitError('Choose whether the commission is a percentage of the price or a flat fee.');
  if (!Number.isFinite(n) || n < 0) throw new SplitError('Enter the commission as zero or more.');
  if (type === 'percent' && n > 100) throw new SplitError('A commission percentage must be between 0 and 100.');
  if (n > 100_000_000) throw new SplitError('That commission is too large.');
  return { type, value: type === 'percent' ? Math.round(n * 1000) / 1000 : Math.round(n * 100) / 100 };
}

/** Gross commission in cents expected from a sale price and a rate, or null when either is missing. */
export function expectedGrossCents(price: number | null | undefined, rate: CommissionRate | null | undefined): number | null {
  if (!rate) return null;
  if (rate.type === 'flat') return rate.value > 0 ? toCents(rate.value) : null;
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0 || rate.value <= 0) return null;
  return Math.round((toCents(p) * rate.value) / 100);
}

/** Both sides of a split, so no one has to work out the other half: "Agent keeps 80% · Brokerage keeps 20%". */
export const splitBothSides = (type: SplitType, value: number): string =>
  type === 'percent' ? `Agent keeps ${value}% · Brokerage keeps ${Math.round((100 - value) * 1000) / 1000}%` : splitLabel(type, value);

/** What the gross commission is as a share of the sale price, e.g. 3 for 3%. Null with no price or no gross. */
export const grossPercentOfPrice = (price: number | null | undefined, grossCents: number | null | undefined): number | null =>
  price && price > 0 && grossCents ? Math.round((grossCents / 100 / price) * 100 * 1000) / 1000 : null;

export const rateLabel = (rate: CommissionRate): string =>
  rate.type === 'percent' ? `${rate.value}% of the sale price` : `$${rate.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} flat`;

/**
 * An invoice's fee lines after the agent edits THEIR lines: the brokerage's own lines stay exactly as they are, and the agent's
 * lines (marked `by: 'agent'`) are replaced by what they sent. The agent can never change or remove a brokerage line.
 */
export function mergeAgentFees(existing: Deduction[] | null | undefined, agentLines: unknown): Deduction[] {
  const mine = cleanDeductions(agentLines).map((d) => ({ label: d.label, amount: d.amount, by: 'agent' as const }));
  const theirs = (existing ?? []).filter((d) => d.by !== 'agent');
  if (theirs.length + mine.length > 10) throw new SplitError('No more than 10 fees on a deal.');
  return [...theirs, ...mine];
}
