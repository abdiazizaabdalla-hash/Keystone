import { NextResponse } from 'next/server';

// Removed: team owners can no longer view a teammate's transactions or reassign them from here.
export async function GET() {
  return NextResponse.json({ error: 'This feature has been removed.' }, { status: 410 });
}

export async function PATCH() {
  return NextResponse.json({ error: 'This feature has been removed.' }, { status: 410 });
}
