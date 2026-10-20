import { OFFER_STATUSES, SHOWING_INTEREST, SHOWING_KINDS, addDaysIso, cleanMoney, cleanText, dueFromOffset, isIsoDate } from '@/lib/listings';

// Rules for the four things that hang off a listing: checklist steps, offers, contacts, extra dates.

export type ChildKind = 'tasks' | 'offers' | 'contacts' | 'dates' | 'showings';

export const CHILD_TABLE: Record<ChildKind, string> = {
  tasks: 'listing_tasks',
  offers: 'listing_offers',
  contacts: 'listing_contacts',
  dates: 'listing_dates',
  showings: 'listing_showings',
};

export function isChildKind(v: string): v is ChildKind {
  return v in CHILD_TABLE;
}

type Listing = { planned_list_date: string | null };
type Cleaned = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

const MAX_PER_LISTING = 200;
export { MAX_PER_LISTING };

export function cleanChild(kind: ChildKind, body: Record<string, unknown>, listing: Listing, partial: boolean): Cleaned {
  const v: Record<string, unknown> = {};

  if (kind === 'tasks') {
    if (!partial || 'name' in body) {
      const name = cleanText(body.name, 200);
      if (!name) return { ok: false, error: 'Give the step a name' };
      v.name = name;
    }
    if ('completed' in body) {
      v.completed = body.completed === true;
      v.completed_at = body.completed === true ? new Date().toISOString() : null;
    }
    if ('dueDate' in body) {
      if (body.dueDate && !isIsoDate(body.dueDate)) return { ok: false, error: 'That date does not look right' };
      v.due_date = body.dueDate || null;
      // A hand-picked date keeps following the list date: remember how far from it this step sits.
      if (body.dueDate && listing.planned_list_date) {
        const diff = Math.round((Date.parse(`${body.dueDate}T00:00:00Z`) - Date.parse(`${listing.planned_list_date}T00:00:00Z`)) / 86400000);
        v.offset_days = diff;
      } else {
        v.offset_days = null;
      }
    } else if (!partial && 'offsetDays' in body) {
      const n = Math.round(Number(body.offsetDays));
      if (Number.isFinite(n) && Math.abs(n) < 3650) {
        v.offset_days = n;
        v.due_date = dueFromOffset(listing.planned_list_date, n);
      }
    }
    return { ok: true, value: v };
  }

  if (kind === 'offers') {
    if (!partial || 'buyerName' in body) v.buyer_name = cleanText(body.buyerName, 200);
    if (!partial || 'buyerAgent' in body) v.buyer_agent = cleanText(body.buyerAgent, 200);
    if (!partial || 'offerPrice' in body) v.offer_price = cleanMoney(body.offerPrice);
    if (!partial || 'terms' in body) v.terms = cleanText(body.terms, 2000);
    if ('status' in body) {
      if (!OFFER_STATUSES.includes(body.status as (typeof OFFER_STATUSES)[number])) return { ok: false, error: 'Unknown offer status' };
      v.status = body.status;
    }
    if (!partial || 'receivedOn' in body) v.received_on = isIsoDate(body.receivedOn) ? body.receivedOn : null;
    if (!partial || 'financing' in body) v.financing = cleanText(body.financing, 60);
    if (!partial || 'earnestMoney' in body) v.earnest_money = cleanMoney(body.earnestMoney);
    if (!partial || 'sellerConcessions' in body) v.seller_concessions = cleanMoney(body.sellerConcessions);
    if (!partial || 'optionDays' in body) {
      const n = body.optionDays === '' || body.optionDays == null ? null : Math.round(Number(body.optionDays));
      v.option_days = n !== null && Number.isFinite(n) && n >= 0 && n < 400 ? n : null;
    }
    if (!partial || 'closingDate' in body) v.closing_date = isIsoDate(body.closingDate) ? body.closingDate : null;
    if (!partial && !v.buyer_name && v.offer_price === null) return { ok: false, error: 'Add a buyer name or an offer price' };
    return { ok: true, value: v };
  }

  if (kind === 'contacts') {
    const role = cleanText(body.role, 60);
    const name = cleanText(body.name, 200);
    const email = cleanText(body.email, 254)?.toLowerCase() ?? null;
    const phone = cleanText(body.phone, 40);
    if (!partial && !role && !name && !email && !phone) return { ok: false, error: 'Add at least one detail' };
    if (!partial || 'role' in body) v.role = role;
    if (!partial || 'name' in body) v.name = name;
    if (!partial || 'email' in body) v.email = email;
    if (!partial || 'phone' in body) v.phone = phone;
    return { ok: true, value: v };
  }

  if (kind === 'showings') {
    if (!partial || 'showingDate' in body) {
      if (!isIsoDate(body.showingDate)) return { ok: false, error: 'Pick the date' };
      v.showing_date = body.showingDate;
    }
    if ('kind' in body) {
      if (!SHOWING_KINDS.includes(body.kind as (typeof SHOWING_KINDS)[number])) return { ok: false, error: 'Unknown type' };
      v.kind = body.kind;
    }
    if (!partial || 'visitor' in body) v.visitor = cleanText(body.visitor, 200);
    if (!partial || 'interest' in body) {
      v.interest = SHOWING_INTEREST.includes(body.interest as (typeof SHOWING_INTEREST)[number]) ? body.interest : null;
    }
    if (!partial || 'feedback' in body) v.feedback = cleanText(body.feedback, 2000);
    return { ok: true, value: v };
  }

  // dates
  if (!partial || 'label' in body) {
    const label = cleanText(body.label, 120);
    if (!label) return { ok: false, error: 'Give the date a label' };
    v.label = label;
  }
  if (!partial || 'dueDate' in body) {
    if (!isIsoDate(body.dueDate)) return { ok: false, error: 'Pick a date' };
    v.due_date = body.dueDate;
  }
  return { ok: true, value: v };
}

export { addDaysIso };
