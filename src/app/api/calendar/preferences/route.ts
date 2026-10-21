import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getCalendarPrefs, PREF_KEYS, type CalendarPrefs } from '@/lib/calendarPrefs';
import { queueBackfillUserCalendar } from '@/lib/calendarSync';

// What goes on my calendar. Read by the settings card; saved there too. Only ever the caller's own row.

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    return NextResponse.json(await getCalendarPrefs(user.id));
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error loading calendar preferences:', error);
    return NextResponse.json({ error: 'Failed to load calendar preferences' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const current = await getCalendarPrefs(user.id);
    const next: CalendarPrefs = { ...current };
    for (const k of PREF_KEYS) {
      if (k in body) {
        if (typeof body[k] !== 'boolean') return NextResponse.json({ error: `${k} must be true or false` }, { status: 400 });
        next[k] = body[k];
      }
    }

    const { error } = await supabaseServer
      .from('calendar_preferences')
      .upsert({ user_id: user.id, ...next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) {
      console.error('Saving calendar preferences failed:', error);
      return NextResponse.json({ error: 'Could not save. Please try again in a moment.' }, { status: 500 });
    }

    // Add or remove the matching events on a connected Google Calendar (a no-op when not connected).
    queueBackfillUserCalendar(user.id);
    return NextResponse.json(next);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error saving calendar preferences:', error);
    return NextResponse.json({ error: 'Failed to save calendar preferences' }, { status: 500 });
  }
}
