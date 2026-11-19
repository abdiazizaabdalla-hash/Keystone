import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { requireTemplatesUser, templateError } from '@/lib/templatesServer';

// The emails recorded instead of sent while RELAY_OUTBOX_ONLY=1 (a developer machine). Empty in production.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { data, error } = await supabaseServer.from('email_outbox').select('*').eq('owner_user_id', user.id).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error) {
    return templateError(error, 'load the outbox of');
  }
}
