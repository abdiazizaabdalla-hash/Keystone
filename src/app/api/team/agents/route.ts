import { NextResponse } from 'next/server';

// Removed: there is no shared brokerage agent directory any more. Every coordinator keeps their own agents,
// contacts and deals, private to their own login. (Kept as an empty list so older pages that still ask for it
// simply show nothing.)
export async function GET() {
  return NextResponse.json([]);
}

export async function POST() {
  return NextResponse.json({ error: 'This feature has been removed.' }, { status: 410 });
}
