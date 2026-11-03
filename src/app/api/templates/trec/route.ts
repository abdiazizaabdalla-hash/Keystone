import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { requireTemplatesUser, templateError } from '@/lib/templatesServer';
import { syncTrecCatalog, trecFormUrl, TREC_LIST_URL } from '@/lib/trecCatalog';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 60 * 60 * 1000;

// The Texas folder: TREC's official forms, each with a link to TREC's own page (which always shows the current version).
// The list is re-read from TREC at most once a day; the daily job does it too, so this only does it when nobody else has.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { data: status } = await supabaseServer.from('trec_catalog_status').select('*').eq('id', 1).maybeSingle();
    const checkedAt = status?.last_checked_at ? new Date(status.last_checked_at as string).getTime() : 0;
    const okAt = status?.last_ok_at ? new Date(status.last_ok_at as string).getTime() : 0;
    const neverOk = okAt === 0;
    const stale = Date.now() - okAt > STALE_AFTER_MS && Date.now() - checkedAt > RETRY_AFTER_MS;
    if (neverOk ? Date.now() - checkedAt > RETRY_AFTER_MS : stale) await syncTrecCatalog();

    const [{ data: forms, error }, { data: pins }, { data: fresh }] = await Promise.all([
      supabaseServer.from('trec_forms').select('*').eq('removed', false).order('name', { ascending: true }),
      supabaseServer.from('template_pins').select('ref').eq('owner_user_id', user.id).eq('kind', 'trec'),
      supabaseServer.from('trec_catalog_status').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (error) throw error;
    const pinned = new Set((pins || []).map((p) => p.ref as string));
    return NextResponse.json({
      listUrl: TREC_LIST_URL,
      lastCheckedOk: fresh?.last_ok_at ?? null,
      lastError: fresh?.last_error ?? null,
      forms: (forms || []).map((f) => ({
        slug: f.slug,
        name: f.name,
        formId: f.form_id,
        section: f.section,
        effectiveDate: f.effective_date,
        previousFormId: f.previous_form_id,
        changedAt: f.changed_at,
        url: trecFormUrl(f.slug as string),
        pinned: pinned.has(f.slug as string),
      })),
    });
  } catch (error) {
    return templateError(error, 'load the Texas forms of');
  }
}
