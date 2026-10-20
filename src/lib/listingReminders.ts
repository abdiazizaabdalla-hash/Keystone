import { supabaseServer } from '@/lib/supabase';
import type { ReminderTransactionGroup } from '@/lib/dueDateReminders';

// Listing half of the daily reminder email (see /api/cron/due-date-reminders). Open listings get the same
// rules as deals (unfinished steps: overdue, due today, or exactly 1/3/7 days out), plus:
//   - the listing's own dates (open house, price review...): today and 1/3/7 days out, never "overdue"
//   - the agreement's expiration: heads-up at 30 and 14 days, reminders at 7 and 1 day and on the day
//   - a listing still "active" after its expiration date is flipped to Expired, and the email says so
// Everything here is best effort: if the listing tables are missing it returns nothing instead of failing the email.

const ADVANCE = [1, 3, 7];

export async function collectListingReminders(todayStr: string): Promise<Map<string, ReminderTransactionGroup[]>> {
  const result = new Map<string, ReminderTransactionGroup[]>();
  try {
    const { data: listings, error } = await supabaseServer
      .from('listings')
      .select('id, tc_user_id, property_address, status, expiration_date')
      .in('status', ['preparing', 'active', 'under_offer'])
      .limit(5000);
    if (error || !listings || listings.length === 0) return result;

    const todayMs = new Date(`${todayStr}T00:00:00Z`).getTime();
    const diffOf = (d: string) => Math.round((new Date(`${d}T00:00:00Z`).getTime() - todayMs) / 86400000);

    const groups = new Map<string, ReminderTransactionGroup>();
    const groupFor = (l: { id: unknown; property_address: unknown }) => {
      const id = l.id as string;
      let g = groups.get(id);
      if (!g) {
        g = {
          transactionId: id,
          href: `/dashboard/listings/${id}`,
          label: `Listing · ${l.property_address as string}`,
          overdueTasks: [],
          dueTodayTasks: [],
          dueIn1DayTasks: [],
          dueIn3DaysTasks: [],
          dueIn7DaysTasks: [],
          notes: [],
        };
        groups.set(id, g);
      }
      return g;
    };
    const bucket = (g: ReminderTransactionGroup, diff: number, name: string, allowOverdue: boolean) => {
      if (diff < 0) {
        if (allowOverdue) g.overdueTasks.push(name);
      } else if (diff === 0) g.dueTodayTasks.push(name);
      else if (diff === 1) g.dueIn1DayTasks.push(name);
      else if (diff === 3) g.dueIn3DaysTasks.push(name);
      else if (diff === 7) g.dueIn7DaysTasks.push(name);
    };

    const ids = listings.map((l) => l.id as string);
    const byId = new Map(listings.map((l) => [l.id as string, l]));
    const windowEnd = new Date(todayMs + 7 * 86400000).toISOString().split('T')[0];
    const [{ data: tasks }, { data: dates }] = await Promise.all([
      supabaseServer.from('listing_tasks').select('listing_id, name, due_date').in('listing_id', ids).eq('completed', false).not('due_date', 'is', null).lte('due_date', windowEnd),
      supabaseServer.from('listing_dates').select('listing_id, label, due_date').in('listing_id', ids).gte('due_date', todayStr).lte('due_date', windowEnd),
    ]);
    for (const t of tasks || []) {
      const l = byId.get(t.listing_id as string);
      if (l) bucket(groupFor(l), diffOf(t.due_date as string), t.name as string, true);
    }
    for (const d of dates || []) {
      const l = byId.get(d.listing_id as string);
      if (l) bucket(groupFor(l), diffOf(d.due_date as string), `Date: ${d.label as string}`, false);
    }

    for (const l of listings) {
      const exp = l.expiration_date as string | null;
      if (!exp) continue;
      const diff = diffOf(exp);
      const isActive = l.status === 'active';
      if (diff < 0 && isActive) {
        // Past its end date and still marked active: close it out and say so once.
        const { error: upErr } = await supabaseServer.from('listings').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', l.id).eq('status', 'active');
        if (!upErr) {
          groupFor(l).notes!.push(`The listing agreement expired on ${exp}. Status was set to Expired. Reopen or relist it if the seller extended.`);
          await supabaseServer.from('listing_activity').insert({ listing_id: l.id, actor_label: 'Relay TC', summary: `Listing expired on ${exp}; status set to Expired` });
        }
        continue;
      }
      if (diff < 0) continue;
      if (diff === 30 || diff === 14) groupFor(l).notes!.push(`Listing agreement expires in ${diff} days (${exp}). Ask the seller whether to extend, relist or let it end.`);
      else if (diff === 0 || ADVANCE.includes(diff) || diff === 7) bucket(groupFor(l), diff, 'Listing agreement expires', false);
    }

    for (const g of groups.values()) {
      const total = g.overdueTasks.length + g.dueTodayTasks.length + g.dueIn1DayTasks.length + g.dueIn3DaysTasks.length + g.dueIn7DaysTasks.length + (g.notes?.length || 0);
      if (total === 0) continue;
      const owner = byId.get(g.transactionId)!.tc_user_id as string;
      const list = result.get(owner) || [];
      list.push(g);
      result.set(owner, list);
    }
  } catch (error) {
    console.error('Listing reminders failed (ignored):', error);
  }
  return result;
}
