import { supabaseServer } from './supabase';
import { diffCatalog, MIN_SANE_ROWS, parseTrecContractsPage, TREC_LIST_URL, type StoredTrec, type TrecRow } from './trecParse';
export { trecFormUrl, TREC_LIST_URL, TREC_BASE } from './trecParse';
export type { TrecRow, TrecSection } from './trecParse';

// The Texas folder: TREC's official forms, listed with a link to TREC's own page for each. Relay never copies a TREC form.
// The list comes from the public contracts page, re-read once a day, so a revised form (20-18 becoming 20-19, say)
// shows up as "updated" and the link keeps going to TREC, which publishes the current version.

async function setStatus(fields: { last_ok_at?: string; last_error: string | null }) {
  await supabaseServer.from('trec_catalog_status').upsert({ id: 1, last_checked_at: new Date().toISOString(), ...fields });
}

/** Re-reads TREC's page and updates the list. Never throws: a failed check leaves the last known list in place. */
export async function syncTrecCatalog(): Promise<{ ok: boolean; added: number; changed: number; error?: string }> {
  try {
    const res = await fetch(TREC_LIST_URL, { headers: { 'user-agent': 'RelayTC form-link checker', accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`TREC answered ${res.status}`);
    const rows = parseTrecContractsPage(await res.text());
    if (rows.length < MIN_SANE_ROWS) throw new Error(`The TREC page looked different than expected (${rows.length} forms found)`);

    const { data: existing, error } = await supabaseServer.from('trec_forms').select('slug, form_id, effective_date, removed');
    if (error) throw error;
    const diff = diffCatalog((existing || []) as StoredTrec[], rows);
    const nowIso = new Date().toISOString();

    const toRow = (r: TrecRow) => ({ slug: r.slug, name: r.name, form_id: r.formId, section: r.section, effective_date: r.effectiveDate, last_seen_at: nowIso, removed: false });
    const writes = [
      ...diff.added.map((r) => ({ ...toRow(r), first_seen_at: nowIso })),
      ...diff.changed.map((c) => ({ ...toRow(c.row), previous_form_id: c.previousFormId, changed_at: nowIso })),
      ...diff.unchanged.map(toRow),
    ];
    for (let i = 0; i < writes.length; i += 100) {
      const { error: writeError } = await supabaseServer.from('trec_forms').upsert(writes.slice(i, i + 100), { onConflict: 'slug' });
      if (writeError) throw writeError;
    }
    if (diff.gone.length > 0) await supabaseServer.from('trec_forms').update({ removed: true }).in('slug', diff.gone);
    await setStatus({ last_ok_at: nowIso, last_error: null });
    return { ok: true, added: diff.added.length, changed: diff.changed.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not read the TREC page';
    console.error('TREC catalog check failed:', message);
    await setStatus({ last_error: message.slice(0, 300) }).catch(() => undefined);
    return { ok: false, added: 0, changed: 0, error: message };
  }
}
