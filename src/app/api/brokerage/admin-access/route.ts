import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { brokerageOn, agentLabels } from '@/lib/oversight';
import { findAdminLink } from '@/lib/brokerageAdminsServer';
import { scopesFor } from '@/lib/brokerageAdmins';

// Is the person signed in an administrator of someone's brokerage, and with which role? Presentation only: every brokerage
// route checks the role again on the server. { delegated: false } for everyone else, and when the feature is off.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) return NextResponse.json({ delegated: false });
    const link = await findAdminLink(user);
    if (!link) return NextResponse.json({ delegated: false });
    const owner = (await agentLabels([link.ownerId])).get(link.ownerId);
    return NextResponse.json({ delegated: true, role: link.role, scopes: scopesFor(link.role), brokerage: owner?.name ?? 'Your brokerage' });
  } catch {
    return NextResponse.json({ delegated: false });
  }
}
