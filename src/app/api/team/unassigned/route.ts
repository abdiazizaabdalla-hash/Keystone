import { NextResponse } from 'next/server';

// Removed: there is no shared "unassigned" queue. A deal always belongs to the coordinator who created it.
export async function GET() {
  return NextResponse.json([]);
}
