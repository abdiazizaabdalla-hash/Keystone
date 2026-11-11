// Pure: which open checklist step does an uploaded document belong to? Deliberately conservative. A wrong guess here would
// stop someone's follow-ups, so when more than one step fits, or none fits clearly, the answer is "ambiguous" or "none" and a
// person decides. An upload is never proof that anything was satisfied: a match only marks the step "received, needs review".

export interface MatchTask {
  id: string;
  name: string;
  completed: boolean;
  waiting_on?: string | null;
}

export type DocumentMatch =
  | { kind: 'match'; taskId: string; reason: string }
  | { kind: 'ambiguous'; taskIds: string[] }
  | { kind: 'none' };

/** Words in a step name that point to a document type. Types not listed use their own name. Generic types never match. */
const KEYWORDS: Record<string, string[]> = {
  'inspection report': ['inspection'],
  'specialized inspections': ['inspection'],
  're-inspection': ['inspection', 're-inspection'],
  'title commitment': ['title commitment', 'commitment'],
  survey: ['survey'],
  'hoa documents': ['hoa'],
  'payoff information': ['payoff'],
  appraisal: ['appraisal'],
  'pre-approval': ['pre-approval', 'preapproval', 'pre approval'],
  'earnest money receipt': ['earnest'],
  'option fee receipt': ['option fee', 'option'],
  'deposit confirmation': ['earnest', 'deposit'],
  'repair requests': ['repair request'],
  'repair amendment': ['repair amendment', 'repair'],
  'repair receipts': ['repair'],
  'seller disclosure': ['seller disclosure', 'disclosure'],
  'lead-based paint disclosure': ['lead-based', 'lead based'],
  'loan documents': ['loan document'],
  'underwriting conditions': ['underwriting', 'conditions'],
};

const GENERIC = (type: string) => !type.trim() || /^general$/i.test(type) || /^other\b/i.test(type);
const RECEIPTISH = /\b(report|commitment|receipt|collect|receive|received|obtain|upload|copy|documents?|letter|confirmation)\b/i;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function keywordsFor(documentType: string): string[] {
  const t = norm(documentType);
  if (GENERIC(t)) return [];
  return KEYWORDS[t] ?? [t];
}

export function matchDocumentToTasks(doc: { documentType: string; taskId?: string | null }, tasks: MatchTask[]): DocumentMatch {
  const open = tasks.filter((t) => !t.completed);
  // The person said which step it is for when uploading: that is as confident as it gets.
  if (doc.taskId) {
    const t = open.find((x) => x.id === doc.taskId);
    return t ? { kind: 'match', taskId: t.id, reason: 'You attached it to this step.' } : { kind: 'none' };
  }
  const words = keywordsFor(doc.documentType);
  if (words.length === 0) return { kind: 'none' };
  const scored: { id: string; score: number }[] = [];
  for (const t of open) {
    const name = norm(t.name);
    const hit = words.some((w) => name.includes(w));
    if (!hit) continue;
    const waiting = Boolean(t.waiting_on && t.waiting_on.trim());
    if (!waiting && !RECEIPTISH.test(name)) continue; // "Schedule inspection" is not waiting for a report
    scored.push({ id: t.id, score: (waiting ? 2 : 0) + (RECEIPTISH.test(name) ? 1 : 0) });
  }
  if (scored.length === 0) return { kind: 'none' };
  const top = Math.max(...scored.map((s) => s.score));
  const best = scored.filter((s) => s.score === top);
  if (best.length > 1) return { kind: 'ambiguous', taskIds: best.map((b) => b.id) };
  return { kind: 'match', taskId: best[0].id, reason: `Matched the ${doc.documentType} you uploaded.` };
}
