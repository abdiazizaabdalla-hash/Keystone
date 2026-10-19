import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { toCsv, type ContactRow } from '@/lib/contactsCrm';

// CSV download of this TC's contacts, ready for Mailchimp, Constant Contact, etc.
//   ?newsletter=1  only people marked as agreeing to the newsletter (and with an email)
//   ?tag=Name      only contacts carrying that tag
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });

    const params = new URL(request.url).searchParams;
    const newsletterOnly = params.get('newsletter') === '1';
    const tag = (params.get('tag') || '').trim().toLowerCase();

    const { data, error } = await supabaseServer
      .from('contacts')
      .select('*')
      .eq('tc_user_id', user.id)
      .order('name', { ascending: true })
      .limit(5000);
    if (error) throw error;

    const rows = ((data || []) as ContactRow[]).filter(
      (c) => (!newsletterOnly || (c.newsletter && c.email)) && (!tag || (c.tags || []).some((t) => t.toLowerCase() === tag))
    );

    const csv = toCsv(
      ['Name', 'Email', 'Phone', 'Company', 'Role', 'Tags', 'Newsletter', 'Notes'],
      rows.map((c) => [c.name, c.email, c.phone, c.company, c.role, (c.tags || []).join('; '), c.newsletter ? 'yes' : 'no', c.notes])
    );
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="relay-contacts${newsletterOnly ? '-newsletter' : ''}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error exporting contacts:', error);
    return NextResponse.json({ error: 'Failed to export contacts' }, { status: 500 });
  }
}
