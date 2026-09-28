import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function GET() {
  const results: Record<string, unknown> = {};
  for (const table of ['payment_accounts']) {
    const { data, error } = await supabaseServer.from(table).select('*').limit(1);
    results[table] = error ? { error: error.message } : { ok: true, sample: data };
  }
  return NextResponse.json(results);
}
