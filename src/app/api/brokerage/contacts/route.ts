import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { agentLabels } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { resolveTeamAccess } from '@/lib/teamMessaging';

// The contacts a brokerage has chosen to share with the whole brokerage, for an agent who joined it. Read-only: the
// fields of the shared address book (no notes, no follow-ups). Teammates use /api/contacts instead.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const access = await resolveTeamAccess(user.id);
    if (!access?.viaBrokerage) throw new AuthError('Shared contacts are for agents in a brokerage.', 403);

    const { data, error } = await supabaseServer
      .from('contacts')
      .select('id, tc_user_id, name, email, phone, company, role, tags, contact_type, team_id, shared_at, created_at, updated_at')
      .eq('team_id', access.teamId)
      .order('name', { ascending: true })
      .limit(2000);
    if (error) {
      // Sharing not set up in the database yet: an empty list, not an error.
      console.error('Brokerage contacts unavailable (has add-contacts-team-sharing.sql been run?):', error.message);
      return NextResponse.json([]);
    }
    const labels = await agentLabels((data ?? []).map((c) => c.tc_user_id as string));
    return NextResponse.json((data ?? []).map((c) => ({ ...c, is_mine: false, shared_by_name: labels.get(c.tc_user_id as string)?.name ?? 'The brokerage' })));
  } catch (error) {
    return oversightError(error, 'load shared contacts');
  }
}
