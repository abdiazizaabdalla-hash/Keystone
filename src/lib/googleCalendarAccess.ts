// While Google's app verification is pending, the "Connect Google Calendar" button is only
// offered to the people on a short allowlist (so nobody else lands on Google's
// "hasn't verified this app" warning). Once Google approves the app, set
// GOOGLE_CALENDAR_PUBLIC=true in the environment and everyone sees the button.
//
//   GOOGLE_CALENDAR_PUBLIC=true                      -> everyone
//   GOOGLE_CALENDAR_BETA_EMAILS=a@x.com,b@y.com      -> only these Relay login emails
//
// Anyone who is already connected keeps working and can always disconnect.
export function googleCalendarAvailableFor(email: string | null | undefined): boolean {
  if ((process.env.GOOGLE_CALENDAR_PUBLIC || '').trim().toLowerCase() === 'true') return true;
  const e = (email || '').trim().toLowerCase();
  if (!e) return false;
  const list = (process.env.GOOGLE_CALENDAR_BETA_EMAILS || '')
    .split(/[,\s;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(e);
}
