import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { OVERSIGHT_TERMS, activeLinkForAgent, agentLabels, assertBrokerageAgent, overseesAgent, pendingInvitesFor } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { hasBrokerageAccess } from '@/lib/brokerageAccessMeta';

// The agent's side: the brokerage they have joined (if any), invitations waiting for them, and exactly what the brokerage can see.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertBrokerageAgent(user);
    const [current, invites] = await Promise.all([activeLinkForAgent(user.id), pendingInvitesFor(user.id, user.email)]);
    // If the brokerage's plan has lapsed, nothing is shared right now; say so instead of showing them as active.
    const paused = current ? !(await overseesAgent(current.owner_user_id, user.id)) : false;
    const labels = await agentLabels([...(current ? [current.owner_user_id] : []), ...invites.map((i) => i.owner_user_id)]);
    const who = (id: string) => labels.get(id) ?? { id, name: 'A brokerage', email: null };
    return NextResponse.json({
      current: current ? { id: current.id, owner: who(current.owner_user_id), since: current.responded_at, paused } : null,
      invites: invites.map((i) => ({ id: i.id, owner: who(i.owner_user_id), invitedAt: i.invited_at })),
      // True when this agent's workspace comes from the brokerage (Agent Basic), so leaving ends it.
      providesWorkspace: hasBrokerageAccess(user),
      terms: OVERSIGHT_TERMS,
    });
  } catch (error) {
    return oversightError(error, 'load your brokerage');
  }
}
