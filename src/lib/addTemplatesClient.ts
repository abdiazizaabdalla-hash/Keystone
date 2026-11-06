import { authFetch } from '@/lib/authClient';

// Adds letters and forms to a deal's Documents in one request (see /api/templates/add-to-deal), and says in one line what happened.

export interface AddTemplatesResult {
  added: { templateId: string; name: string; kind: 'letter' | 'form'; documentId: string | null; blanks: string[] }[];
  skipped: { templateId: string; name: string; reason: string }[];
}

export async function addTemplatesToDeal(transactionId: string, templateIds: string[], skipExisting: boolean): Promise<AddTemplatesResult> {
  const res = await authFetch('/api/templates/add-to-deal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionId, templateIds, skipExisting }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || 'Could not add that to this deal');
  return json as AddTemplatesResult;
}

export function summarizeAdded(r: AddTemplatesResult): string {
  const parts: string[] = [];
  if (r.added.length === 1) parts.push(`Added “${r.added[0].name}” to this deal’s Documents.`);
  else if (r.added.length > 1) parts.push(`Added ${r.added.length} PDFs to this deal’s Documents.`);
  const blanks = r.added.filter((a) => a.blanks.length > 0);
  if (blanks.length > 0) parts.push(`Some details were missing on the deal, so part of ${blanks.map((b) => `“${b.name}”`).join(', ')} was left blank.`);
  if (r.skipped.length > 0) parts.push(`Left out: ${r.skipped.map((s) => `${s.name} (${s.reason.replace(/\.$/, '').toLowerCase()})`).join('; ')}.`);
  return parts.join(' ') || 'Nothing was added.';
}
