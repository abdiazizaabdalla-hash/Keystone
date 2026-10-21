import { supabaseServer } from './supabase';

// Which kinds of dates a user wants on their calendar. Applies to the Google Calendar sync AND the
// subscribe (.ics) link. A missing row, or the table not existing yet, means "everything on", which is
// how the calendar behaved before preferences existed.

export interface CalendarPrefs {
  critical_dates: boolean;
  closing_date: boolean;
  deal_tasks: boolean;
  listing_steps: boolean;
  listing_dates: boolean;
}

export const PREF_KEYS = ['critical_dates', 'closing_date', 'deal_tasks', 'listing_steps', 'listing_dates'] as const;

export const DEFAULT_PREFS: CalendarPrefs = {
  critical_dates: true,
  closing_date: true,
  deal_tasks: true,
  listing_steps: true,
  listing_dates: true,
};

export async function getCalendarPrefs(userId: string): Promise<CalendarPrefs> {
  try {
    const { data, error } = await supabaseServer.from('calendar_preferences').select('*').eq('user_id', userId).maybeSingle();
    if (error || !data) return { ...DEFAULT_PREFS };
    const out = { ...DEFAULT_PREFS };
    for (const k of PREF_KEYS) if (typeof data[k] === 'boolean') out[k] = data[k] as boolean;
    return out;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
