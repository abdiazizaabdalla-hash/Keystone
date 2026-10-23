import { NextResponse } from 'next/server';

// Removed: team owners can no longer hand out or take over a teammate's deals.
export async function PATCH() {
  return NextResponse.json({ error: 'This feature has been removed.' }, { status: 410 });
}
