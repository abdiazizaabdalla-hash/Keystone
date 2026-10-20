import { SHOWING_KIND_LABEL, daysBetween, daysOnMarket, mentionsEscalation, LISTING_STATUS_LABEL, type ListingStatus } from '@/lib/listingsShared';

// Builds the plain-text progress update a TC can send a seller. It is a DRAFT built only from what is logged on the
// listing (nothing is invented); the TC reads and edits it before anything is sent. It deliberately leaves out buyer
// names and the other side's private details: counts and feedback text only.

interface Input {
  listing: { property_address: string; seller_name: string | null; status: ListingStatus; list_price: number | null; listed_on?: string | null; expiration_date: string | null; planned_list_date: string | null };
  showings: { showing_date: string; kind: string; interest: string | null; feedback: string | null }[];
  offers: { status: string; offer_price: number | null; offer_expires_at?: string | null; terms?: string | null }[];
  priceChanges: { old_price: number | null; new_price: number; changed_on: string }[];
  dates: { label: string; due_date: string }[];
  tcName: string;
  today: string;
}

const money = (n: number | null | undefined) => (n ? `$${Number(n).toLocaleString('en-US')}` : '');
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildSellerUpdate(i: Input): { subject: string; body: string } {
  const { listing, today } = i;
  const first = (listing.seller_name || '').trim().split(/\s+/)[0];
  const lines: string[] = [];
  lines.push(`Hi ${first || 'there'},`, '', `Here is where things stand on ${listing.property_address} as of ${day(today)}.`, '');

  const dom = daysOnMarket(listing.listed_on, today);
  const status = LISTING_STATUS_LABEL[listing.status] || listing.status;
  lines.push(`Status: ${status}${dom !== null && (listing.status === 'active' || listing.status === 'under_offer') ? `, ${plural(dom, 'day')} on the market` : ''}${listing.list_price ? `. List price ${money(listing.list_price)}.` : '.'}`);

  const recent = i.showings.filter((s) => daysBetween(s.showing_date, today) <= 7 && daysBetween(s.showing_date, today) >= 0);
  if (i.showings.length === 0) {
    lines.push('', 'Showings: none logged yet.');
  } else {
    const byKind = Object.entries(
      i.showings.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.kind]: (acc[s.kind] || 0) + 1 }), {})
    )
      .map(([k, n]) => `${n} ${(SHOWING_KIND_LABEL[k as keyof typeof SHOWING_KIND_LABEL] || 'Showing').toLowerCase()}${n === 1 ? '' : 's'}`)
      .join(', ');
    const hot = i.showings.filter((s) => s.interest === 'hot').length;
    lines.push('', `Showings: ${i.showings.length} so far (${byKind}), ${recent.length} in the last 7 days${hot ? `, ${hot} very interested` : ''}.`);
    const withFeedback = i.showings.filter((s) => s.feedback && s.feedback.trim()).slice(0, 5);
    if (withFeedback.length) {
      lines.push('What visitors said:');
      for (const s of withFeedback) lines.push(`- ${day(s.showing_date)}: ${s.feedback!.trim().replace(/\s+/g, ' ').slice(0, 240)}`);
    }
  }

  const open = i.offers.filter((o) => o.status === 'received' || o.status === 'countered');
  if (i.offers.length === 0) lines.push('', 'Offers: none yet.');
  else {
    lines.push('', `Offers: ${plural(i.offers.length, 'offer')} received${open.length ? `, ${open.length} still being worked` : ''}.`);
    const esc = open.filter((o) => mentionsEscalation(o.terms)).length;
    if (esc) lines.push(`${plural(esc, 'offer')} include${esc === 1 ? 's' : ''} an escalation clause.`);
  }

  if (i.priceChanges.length) {
    const last = i.priceChanges[i.priceChanges.length - 1];
    lines.push('', `Price: last changed on ${day(last.changed_on)}${last.old_price ? ` from ${money(last.old_price)}` : ''} to ${money(last.new_price)}.`);
  }

  const horizon = i.dates
    .filter((d) => d.due_date >= today && daysBetween(today, d.due_date) <= 14)
    .map((d) => ({ label: d.label, date: d.due_date }));
  if (listing.expiration_date && listing.expiration_date >= today && daysBetween(today, listing.expiration_date) <= 30) horizon.push({ label: 'Listing agreement expires', date: listing.expiration_date });
  horizon.sort((a, b) => a.date.localeCompare(b.date));
  if (horizon.length) {
    lines.push('', 'Coming up:');
    for (const h of horizon.slice(0, 6)) lines.push(`- ${day(h.date)}: ${h.label}`);
  }

  lines.push('', 'Let me know if you have any questions or want to talk through next steps.', '', i.tcName || 'Your transaction coordinator');
  return { subject: `Listing update: ${listing.property_address}`, body: lines.join('\n') };
}
