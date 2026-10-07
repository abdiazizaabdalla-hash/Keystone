import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

const BUCKET = 'transaction-documents';
const EXPORT_PREFIX = 'invoice-exports';
// Invoice document bundles are only generated so an email can link to them
// (the link itself expires in 7 days), so nothing needs them after this.
const MAX_AGE_DAYS = 14;

/**
 * Daily retention job: deletes temporary invoice-export zips older than
 * MAX_AGE_DAYS from private storage, so customer documents don't pile up in
 * copies nobody can see or manage. Same auth as the other cron jobs
 * (`Authorization: Bearer ${CRON_SECRET}`, sent automatically by Vercel Cron).
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;

  try {
    // Oldest first, so stale files are always at the front of the list.
    // Deleting them shifts the rest up, so each pass re-reads from the start
    // until a pass finds nothing stale (capped to avoid runaway loops).
    for (let pass = 0; pass < 50; pass++) {
      const { data: files, error } = await supabaseServer.storage
        .from(BUCKET)
        .list(EXPORT_PREFIX, { limit: 100, offset: 0, sortBy: { column: 'created_at', order: 'asc' } });
      if (error) throw error;
      if (!files || files.length === 0) break;

      const stale = files
        .filter((f) => f.created_at && new Date(f.created_at).getTime() < cutoff)
        .map((f) => `${EXPORT_PREFIX}/${f.name}`);
      if (stale.length === 0) break;

      const { error: removeError } = await supabaseServer.storage.from(BUCKET).remove(stale);
      if (removeError) throw removeError;
      removed += stale.length;
      if (files.length < 100) break;
    }
    return NextResponse.json({ removed });
  } catch (error) {
    console.error('Cleanup cron failed:', error);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
