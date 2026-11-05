// What the broker's weekly email says. Pure (no database), so it can be unit tested.

export interface DigestAgent {
  name: string;
  openDeals: number;
  lateTasks: number;
  closingThisWeek: number;
  /** Addresses of the open deals closing in the next 7 days. */
  closingAddresses: string[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line per agent, the ones with late items first. */
export function digestAgentLine(a: DigestAgent): string {
  const bits = [plural(a.openDeals, 'open deal'), a.lateTasks > 0 ? `${a.lateTasks} late` : 'nothing late', a.closingThisWeek > 0 ? `${a.closingThisWeek} closing this week` : null].filter(Boolean);
  return `${a.name}: ${bits.join(', ')}`;
}

/** The email body as paragraphs, or null when there is nothing to report (no agents have joined). */
export function digestParagraphs(agents: DigestAgent[]): string[] | null {
  if (agents.length === 0) return null;
  const sorted = [...agents].sort((a, b) => b.lateTasks - a.lateTasks || b.closingThisWeek - a.closingThisWeek || a.name.localeCompare(b.name));
  const open = sorted.reduce((n, a) => n + a.openDeals, 0);
  const late = sorted.reduce((n, a) => n + a.lateTasks, 0);
  const closing = sorted.reduce((n, a) => n + a.closingThisWeek, 0);
  const head = `Your ${plural(agents.length, 'agent')} ${agents.length === 1 ? 'has' : 'have'} ${plural(open, 'open deal')}. ${late > 0 ? `${plural(late, 'step')} ${late === 1 ? 'is' : 'are'} late.` : 'Nothing is late.'} ${closing > 0 ? `${plural(closing, 'deal')} ${closing === 1 ? 'is' : 'are'} closing this week.` : 'Nothing closes this week.'}`;
  const out = [head, sorted.map(digestAgentLine).join('\n')];
  const addresses = sorted.flatMap((a) => a.closingAddresses.map((addr) => `${addr} (${a.name})`));
  if (addresses.length > 0) out.push(`Closing this week:\n${addresses.join('\n')}`);
  return out;
}

export const digestSubject = (agents: DigestAgent[]) => {
  const late = agents.reduce((n, a) => n + a.lateTasks, 0);
  return late > 0 ? `Your week: ${plural(late, 'late step')} across your agents` : 'Your week across your agents';
};
