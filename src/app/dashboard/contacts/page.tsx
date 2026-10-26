'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { parseCsv } from '@/lib/csvImport';
import Link from 'next/link';
import type { ContactRow } from '@/lib/contactsCrm';
import { tidyTags } from '@/lib/contactCategories';
import AddContactToDealModal from '@/components/AddContactToDealModal';
import ContactEditModal from '@/components/ContactEditModal';
import DuplicateContactsModal from '@/components/DuplicateContactsModal';
import SyncContactsModal from '@/components/SyncContactsModal';
import { dueLabel, todayLocal } from '@/lib/contactDates';

// Contacts: the TC's address book. Everyone in their business in one place, with
// tags to slice it ("lender", "past client", "Austin") and a newsletter flag that
// exports to any email tool. Relay doesn't send newsletters itself.

const inputCls =
  'w-full bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

type SortKey = 'name' | 'newest' | 'oldest';

// A CSV import can be undone for 2 minutes. The server enforces the same limit.
const UNDO_WINDOW_MS = 2 * 60 * 1000;
const LAST_IMPORT_KEY = 'relay.contacts.lastImport';
interface LastImport {
  ids: string[];
  at: number;
}
const countdownLabel = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'newest', label: 'Recently added' },
  { value: 'oldest', label: 'Oldest first' },
];

const addedTime = (c: { created_at?: string | null }) => {
  const t = c.created_at ? Date.parse(c.created_at) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

const formatAdded = (iso?: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [newsletterOnly, setNewsletterOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState('');

  // null = closed, 'new' = adding, a contact = editing it
  const [editing, setEditing] = useState<ContactRow | 'new' | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'person' | 'organization'>('all');
  // The CSV import that can still be undone, and a clock that ticks while it can.
  const [lastImport, setLastImport] = useState<LastImport | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [undoing, setUndoing] = useState(false);
  const rememberImport = (v: LastImport | null) => {
    setLastImport(v);
    try {
      if (v) window.localStorage.setItem(LAST_IMPORT_KEY, JSON.stringify(v));
      else window.localStorage.removeItem(LAST_IMPORT_KEY);
    } catch {
      /* the undo button still works on this page */
    }
  };
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(LAST_IMPORT_KEY);
        if (!raw) return;
        const v = JSON.parse(raw) as LastImport;
        if (v && Array.isArray(v.ids) && v.ids.length && Date.now() - v.at < UNDO_WINDOW_MS) setLastImport(v);
        else window.localStorage.removeItem(LAST_IMPORT_KEY);
      } catch {
        /* nothing to restore */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!lastImport) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t - lastImport.at >= UNDO_WINDOW_MS) {
        setLastImport(null);
        try {
          window.localStorage.removeItem(LAST_IMPORT_KEY);
        } catch {
          /* ignore */
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lastImport]);

  // How the list is ordered. 'newest' puts the most recently added contacts first.
  const [sortBy, setSortByState] = useState<SortKey>('name');
  const setSortBy = (next: SortKey) => {
    setSortByState(next);
    try {
      window.localStorage.setItem('relay.contacts.sort', next);
    } catch {
      /* the sort still works */
    }
  };
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = window.localStorage.getItem('relay.contacts.sort');
        if (saved === 'name' || saved === 'newest' || saved === 'oldest') setSortByState(saved);
      } catch {
        /* default order */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const [followUps, setFollowUps] = useState<{ id: string; contact_id: string; due_on: string; note: string | null; contact_name: string }[]>([]);
  const [showDupes, setShowDupes] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [hasTeam, setHasTeam] = useState(false);
  // Personal = everything I own; Team = what has been shared with my team (mine and teammates').
  const [scope, setScopeState] = useState<'personal' | 'team'>('personal');
  const setScope = (next: 'personal' | 'team') => {
    setScopeState(next);
    setSelected(new Set());
    setActiveTag(null);
    try {
      window.localStorage.setItem('relay.contacts.scope', next);
    } catch {
      /* the toggle still works */
    }
  };
  const [working, setWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleAuth = useCallback(
    (err: unknown) => {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return true;
      }
      return false;
    },
    [router]
  );

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/contacts');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load contacts');
      setContacts(data);
      setError('');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [handleAuth]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Open follow-ups across all contacts. A nicety: if it fails (for example the CRM migration
  // has not been run yet) the page works without it.
  const loadFollowUps = useCallback(async () => {
    try {
      const res = await authFetch('/api/contacts/reminders');
      const data = await res.json();
      if (res.ok) setFollowUps(data.reminders || []);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(loadFollowUps, 0);
    return () => clearTimeout(t);
  }, [loadFollowUps]);

  // Whether this account is on a team (shows the sharing controls). A nicety: it quietly stays off if the check fails.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/contacts/sync');
        const data = await res.json();
        if (res.ok) {
          setHasTeam(Boolean(data.hasTeam));
          try {
            if (data.hasTeam && window.localStorage.getItem('relay.contacts.scope') === 'team') setScopeState('team');
          } catch {
            /* start on Personal */
          }
        }
      } catch {
        /* ignore */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const completeFollowUp = async (contactId: string, reminderId: string) => {
    try {
      const res = await authFetch(`/api/contacts/${contactId}/reminders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reminderId, done: true }),
      });
      if (res.ok) setFollowUps((prev) => prev.filter((f) => f.id !== reminderId));
    } catch {
      /* ignore */
    }
  };

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  // Every time the page opens, quietly add anyone from your deals who is not here yet (agents, lenders, title...).
  // It only adds; it never changes or removes a contact.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/contacts/import-from-deals', { method: 'POST' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.added > 0) {
          await load();
          flash(`Added ${data.added} contact${data.added === 1 ? '' : 's'} from your deals.`);
        }
      } catch {
        /* the manual "Import from my deals" button still works */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [load]);

  // Without a team there is only the personal view.
  const effectiveScope = hasTeam ? scope : 'personal';
  const teamMode = effectiveScope === 'team';
  const scoped = useMemo(() => contacts.filter((c) => (teamMode ? !!c.team_id : c.is_mine !== false)), [contacts, teamMode]);

  const tagCounts = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const c of scoped) {
      for (const t of c.tags || []) {
        const key = t.toLowerCase();
        const entry = map.get(key);
        if (entry) entry.count += 1;
        else map.set(key, { label: t, count: 1 });
      }
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [scoped]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = scoped.filter((c) => {
      if (newsletterOnly && (!c.newsletter || c.is_mine === false)) return false;
      if (typeFilter !== 'all' && (c.contact_type || 'person') !== typeFilter) return false;
      if (activeTag && !(c.tags || []).some((t) => t.toLowerCase() === activeTag)) return false;
      if (!q) return true;
      return [c.name, c.email, c.phone, c.company, c.role, ...(c.tags || [])].some((v) => (v || '').toLowerCase().includes(q));
    });
    // The API already returns A–Z by name, so only the date orders need a re-sort. Ties fall back to name.
    if (sortBy === 'name') return filtered;
    const dir = sortBy === 'newest' ? -1 : 1;
    return [...filtered].sort(
      (a, b) =>
        dir * (addedTime(a) - addedTime(b)) || (a.name || a.email || '').localeCompare(b.name || b.email || '')
    );
  }, [scoped, search, activeTag, newsletterOnly, typeFilter, sortBy]);

  // The newsletter flag belongs to whoever owns the contact, so teammates' shared contacts never count.
  const newsletterCount = contacts.filter((c) => c.is_mine !== false && c.newsletter && c.email).length;
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((c) => next.delete(c.id));
      else visible.forEach((c) => next.add(c.id));
      return next;
    });

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('That file is over 5 MB.');
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) throw new Error('Could not find any rows. The first row should have column names like Name and Email.');
      const head = parsed[0].map((h) => h.trim().toLowerCase());
      const find = (...names: string[]) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
      const iName = find('full name', 'name', 'contact');
      const iFirst = find('first name', 'first');
      const iLast = find('last name', 'last', 'surname');
      const iEmail = find('email', 'e-mail');
      const iPhone = find('mobile', 'phone', 'cell');
      const iCompany = find('company', 'brokerage', 'organization');
      const iRole = find('role', 'job title', 'position', 'type', 'category', 'title');
      const iTags = find('tags', 'tag', 'groups', 'group', 'labels', 'label');
      if (iEmail < 0 && iName < 0 && iFirst < 0) throw new Error('Could not find a Name or Email column.');
      const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
      const rows = parsed.slice(1).map((r) => ({
        name: get(r, iName) || [get(r, iFirst), get(r, iLast)].filter(Boolean).join(' '),
        email: get(r, iEmail),
        phone: get(r, iPhone),
        company: get(r, iCompany),
        role: get(r, iRole),
        // Tags may be separated by commas, semicolons or pipes.
        tags: get(r, iTags).replace(/[;|]/g, ','),
      }));
      setWorking(true);
      let added = 0;
      let dup = 0;
      let bad = 0;
      let tagged = 0;
      const addedIds: string[] = [];
      for (let i = 0; i < rows.length; i += 500) {
        const res = await authFetch('/api/contacts/import-csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: rows.slice(i, i + 500) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Import failed');
        added += data.added;
        dup += data.skippedDuplicate;
        bad += data.skippedInvalid;
        tagged += data.autoTagged || 0;
        if (Array.isArray(data.ids)) addedIds.push(...data.ids);
      }
      if (addedIds.length > 0) {
        rememberImport({ ids: addedIds, at: Date.now() });
        setNow(Date.now());
      }
      flash(
        `Added ${added} contact${added === 1 ? '' : 's'}` +
          (tagged ? `, ${tagged} tagged automatically from their role or company` : '') +
          `. ${dup} already in your list, ${bad} skipped (no usable name or email). Nobody was added to your newsletter.`
      );
      await load();
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setWorking(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const undoImport = async () => {
    if (!lastImport || undoing) return;
    setUndoing(true);
    setError('');
    try {
      const res = await authFetch('/api/contacts/import-csv/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: lastImport.ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not undo the import');
      rememberImport(null);
      await load();
      flash(
        `Import undone: removed ${data.removed} contact${data.removed === 1 ? '' : 's'}.` +
          (data.kept ? ` ${data.kept} were left because you changed or shared them.` : '') +
          (data.expired ? ` ${data.expired} could not be removed because the 2 minutes were up.` : '')
      );
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Could not undo the import');
    } finally {
      setUndoing(false);
    }
  };

  const runBulk = async (action: string, extra: Record<string, unknown> = {}) => {
    if (selected.size === 0) return;
    if (action === 'delete') {
      const theirs = contacts.filter((c) => selected.has(c.id) && c.is_mine === false).length;
      const note = theirs > 0 ? ` ${theirs} shared by teammates will only be taken off the team list; they stay with whoever shared them.` : '';
      if (!confirm(`Delete ${selected.size - theirs} contact${selected.size - theirs === 1 ? '' : 's'}? This cannot be undone.${note}`)) return;
    }
    if (action === 'share_team' && !confirm(`Share ${selected.size} contact${selected.size === 1 ? '' : 's'} with your team? Everyone on the team will be able to see and edit their details.`)) return;
    setWorking(true);
    try {
      const res = await authFetch('/api/contacts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      if (action === 'delete') setSelected(new Set());
      if (action === 'add_tag' || action === 'remove_tag') setBulkTag('');
      await load();
      if (action === 'share_team') flash(`Shared ${data.shared} with your team${data.skippedDuplicate ? `. ${data.skippedDuplicate} were already on the team list` : ''}.`);
      else flash('Done.');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setWorking(false);
    }
  };

  const [addTo, setAddTo] = useState<ContactRow | null>(null);

  // How many contacts still carry role-style tags that the tidy-up would group into categories.
  const untidyCount = useMemo(() => contacts.filter((c) => c.is_mine !== false &&  tidyTags(c.role, c.tags || []) !== (c.tags || [])).length, [contacts]);

  const tidyUp = async () => {
    setWorking(true);
    setError('');
    try {
      const res = await authFetch('/api/contacts/tidy-tags', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to tidy tags');
      await load();
      flash(data.changed > 0 ? `Grouped tags into categories for ${data.changed} contact${data.changed === 1 ? '' : 's'}.` : 'Tags are already grouped.');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to tidy tags');
    } finally {
      setWorking(false);
    }
  };

  const importFromDeals = async () => {
    setWorking(true);
    setError('');
    try {
      const res = await authFetch('/api/contacts/import-from-deals', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import');
      await load();
      flash(data.added > 0 ? `Added ${data.added} contact${data.added === 1 ? '' : 's'} from your deals.` : 'Everyone from your deals is already here.');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setWorking(false);
    }
  };

  const exportCsv = async (newsletter: boolean) => {
    try {
      const qs = new URLSearchParams();
      if (newsletter) qs.set('newsletter', '1');
      if (activeTag) qs.set('tag', activeTag);
      const res = await authFetch(`/api/contacts/export?${qs.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = newsletter ? 'relay-contacts-newsletter.csv' : 'relay-contacts.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to export');
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <p className="text-slate-400">Loading contacts…</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 mb-1">Contacts</h1>
          <p className="text-slate-400">
            {teamMode ? 'Contacts your team shares. Everyone on the team can see and edit these.' : 'The people and organizations in your business, with history and follow-ups.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!teamMode && untidyCount > 0 && (
            <button
              type="button"
              onClick={tidyUp}
              disabled={working}
              className="px-4 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition disabled:opacity-50"
              title="Turns role-style tags like &quot;seller's preferred inspector&quot; into broad categories like Inspector. Roles and tags you typed yourself are not changed."
            >
              Group tags ({untidyCount})
            </button>
          )}
          {!teamMode && (
          <button
            type="button"
            onClick={importFromDeals}
            disabled={working}
            className="px-4 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition disabled:opacity-50"
          >
            Import from my deals
          </button>
          )}
          {hasTeam && (
            <button
              type="button"
              onClick={() => setShowSync(true)}
              className="px-4 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition"
            >
              Sync contacts
            </button>
          )}
          {!teamMode && (
          <button
            type="button"
            onClick={() => setShowDupes(true)}
            className="px-4 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition"
          >
            Find duplicates
          </button>
          )}
          {!teamMode && (
          <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={working}
            className="px-4 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition disabled:opacity-50"
            title="Columns it looks for: Name (or First/Last), Email, Phone, Company, Role, Tags"
          >
            Import CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importCsv(e.target.files?.[0])} />
          </>
          )}
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition"
          >
            + Add contact
          </button>
        </div>
      </div>

      {hasTeam && (
        <div className="mb-5 grid grid-cols-2 gap-1 p-1 bg-white/5 border border-white/10 rounded-2xl max-w-xl" role="tablist" aria-label="Which contacts">
          {(
            [
              { id: 'personal', label: 'Personal', sub: 'Only you', count: contacts.filter((c) => c.is_mine !== false).length },
              { id: 'team', label: 'Team', sub: 'Shared with your team', count: contacts.filter((c) => !!c.team_id).length },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={effectiveScope === t.id}
              onClick={() => setScope(t.id)}
              className={`rounded-xl px-4 py-3 text-left transition ${effectiveScope === t.id ? 'bg-blue-500 text-white shadow' : 'text-slate-300 hover:bg-white/10'}`}
            >
              <span className="block text-base font-semibold">
                {t.label} <span className={`text-sm font-normal ${effectiveScope === t.id ? 'text-blue-100' : 'text-slate-500'}`}>({t.count})</span>
              </span>
              <span className={`block text-xs ${effectiveScope === t.id ? 'text-blue-100' : 'text-slate-500'}`}>{t.sub}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {notice && <p className="mb-4 text-sm text-green-400">{notice}</p>}

      {lastImport && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm text-slate-200" role="status">
          <span>
            Imported {lastImport.ids.length} contact{lastImport.ids.length === 1 ? '' : 's'}. Changed your mind?
          </span>
          <button
            type="button"
            onClick={undoImport}
            disabled={undoing}
            className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
          >
            {undoing ? 'Undoing…' : 'Undo import'}
          </button>
          <span className="text-xs text-slate-400">{countdownLabel(lastImport.at + UNDO_WINDOW_MS - now)} left</span>
        </div>
      )}

      {followUps.length > 0 && (
        <div className="mb-4 bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Follow-ups ({followUps.length})</p>
          <ul className="space-y-1.5">
            {followUps.slice(0, 6).map((f) => {
              const due = dueLabel(f.due_on, todayLocal());
              return (
                <li key={f.id} className="flex items-center gap-3 text-sm">
                  <input type="checkbox" checked={false} onChange={() => completeFollowUp(f.contact_id, f.id)} className="accent-blue-500" aria-label={`Mark follow-up with ${f.contact_name} done`} />
                  <Link href={`/dashboard/contacts/${f.contact_id}`} className="text-blue-400 hover:text-blue-300 font-medium">
                    {f.contact_name}
                  </Link>
                  <span className={due.overdue ? 'text-red-300' : 'text-slate-400'}>{due.text}</span>
                  {f.note && <span className="text-slate-500 truncate">· {f.note}</span>}
                </li>
              );
            })}
          </ul>
          {followUps.length > 6 && <p className="text-xs text-slate-500 mt-2">+{followUps.length - 6} more. Open a contact to see all of its follow-ups.</p>}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, company, tag…"
          className={`${inputCls} max-w-sm`}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | 'person' | 'organization')}
          className={inputCls.replace("w-full", "w-auto")}
          aria-label="Show"
        >
          <option value="all">People &amp; organizations</option>
          <option value="person">People</option>
          <option value="organization">Organizations</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className={inputCls.replace("w-full", "w-auto")}
          aria-label="Sort contacts"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Sort: {o.label}
            </option>
          ))}
        </select>
        {!teamMode && (
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={newsletterOnly} onChange={(e) => setNewsletterOnly(e.target.checked)} className="accent-blue-500" />
          Newsletter only ({newsletterCount})
        </label>
        )}
        {!teamMode && (
        <div className="ml-auto flex items-center gap-3 text-sm">
          <button type="button" onClick={() => exportCsv(false)} className="text-blue-400 hover:text-blue-300">
            Export CSV
          </button>
          <button type="button" onClick={() => exportCsv(true)} disabled={newsletterCount === 0} className="text-blue-400 hover:text-blue-300 disabled:opacity-40">
            Export newsletter list
          </button>
        </div>
        )}
      </div>

      {tagCounts.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={`text-xs px-3 py-1 rounded-full border transition ${
              activeTag === null ? 'border-blue-500 text-blue-300 bg-blue-500/10' : 'border-slate-600 text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({scoped.length})
          </button>
          {tagCounts.map(([key, { label, count }]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTag(activeTag === key ? null : key)}
              className={`text-xs px-3 py-1 rounded-full border transition ${
                activeTag === key ? 'border-blue-500 text-blue-300 bg-blue-500/10' : 'border-slate-600 text-slate-400 hover:text-slate-200'
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 px-4 py-3 bg-slate-700/60 border border-slate-600 rounded-lg text-sm">
          <span className="text-slate-200 font-medium">{selected.size} selected</span>
          <input
            value={bulkTag}
            onChange={(e) => setBulkTag(e.target.value)}
            placeholder="Tag name"
            maxLength={30}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm w-36"
          />
          <button type="button" disabled={working || !bulkTag.trim()} onClick={() => runBulk('add_tag', { tag: bulkTag })} className="text-blue-400 hover:text-blue-300 disabled:opacity-40">
            Add tag
          </button>
          <button type="button" disabled={working || !bulkTag.trim()} onClick={() => runBulk('remove_tag', { tag: bulkTag })} className="text-blue-400 hover:text-blue-300 disabled:opacity-40">
            Remove tag
          </button>
          <span className="text-slate-600">|</span>
          <button type="button" disabled={working} onClick={() => runBulk('subscribe')} className="text-blue-400 hover:text-blue-300 disabled:opacity-40">
            Add to newsletter
          </button>
          <button type="button" disabled={working} onClick={() => runBulk('unsubscribe')} className="text-slate-300 hover:text-slate-100 disabled:opacity-40">
            Remove from newsletter
          </button>
          {hasTeam && (
            <>
              <span className="text-slate-600">|</span>
              <button type="button" disabled={working} onClick={() => runBulk('share_team')} className="text-blue-400 hover:text-blue-300 disabled:opacity-40">
                Share with team
              </button>
              <button type="button" disabled={working} onClick={() => runBulk('unshare_team')} className="text-slate-300 hover:text-slate-100 disabled:opacity-40">
                Stop sharing
              </button>
            </>
          )}
          <button type="button" disabled={working} onClick={() => runBulk('delete')} className="text-red-400 hover:text-red-300 disabled:opacity-40 ml-auto">
            Delete
          </button>
        </div>
      )}

      {scoped.length === 0 && teamMode ? (
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8 text-center">
          <p className="text-slate-200 font-semibold mb-1">Nothing shared with your team yet</p>
          <p className="text-slate-400 text-sm mb-5">Share the contacts your whole team works with, like preferred lenders and title companies. Use Sync to share many at once, or add a shared contact.</p>
          <button type="button" onClick={() => setShowSync(true)} className="px-5 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg">
            Sync contacts
          </button>
        </div>
      ) : scoped.length === 0 ? (
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8 text-center">
          <p className="text-slate-200 font-semibold mb-1">Your address book is empty</p>
          <p className="text-slate-400 text-sm mb-5">Pull in the agents and lenders already on your deals, or add someone by hand.</p>
          <button
            type="button"
            onClick={importFromDeals}
            disabled={working}
            className="px-5 py-2.5 bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
          >
            Import from my deals
          </button>
        </div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-700">
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="accent-blue-500" aria-label="Select all shown" />
                </th>
                <th className="px-2 py-3">Name</th>
                <th className="px-2 py-3">Email / phone</th>
                <th className="px-2 py-3">Tags</th>
                <th className="px-2 py-3">Newsletter</th>
                <th className="px-2 py-3 w-44" />
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr
                  key={c.id}
                  onClick={(e) => {
                    // Clicking anywhere on the row opens the profile, except on its own links, buttons and checkbox.
                    if ((e.target as HTMLElement).closest('a, button, input, label, select, textarea')) return;
                    router.push(`/dashboard/contacts/${c.id}`);
                  }}
                  className="border-b border-slate-700/60 last:border-0 hover:bg-slate-700/20 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} className="accent-blue-500" aria-label={`Select ${c.name || c.email}`} />
                  </td>
                  <td className="px-2 py-3">
                    <Link href={`/dashboard/contacts/${c.id}`} className="text-slate-100 font-medium break-words hover:text-blue-300">
                      {c.name || c.email}
                    </Link>
                    {c.team_id && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-emerald-600/50 text-emerald-300">
                        {c.is_mine === false ? `Shared by ${c.shared_by_name || 'a teammate'}` : 'Shared'}
                      </span>
                    )}
                    {c.contact_type === 'organization' && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-slate-600 text-slate-400">Org</span>}
                    <p className="text-xs text-slate-500 break-words">{[c.role, c.company].filter(Boolean).join(' · ')}</p>
                    {sortBy !== 'name' && formatAdded(c.created_at) && (
                      <p className="text-xs text-slate-600">Added {formatAdded(c.created_at)}</p>
                    )}
                  </td>
                  <td className="px-2 py-3 text-slate-300">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="text-blue-400 hover:text-blue-300 break-all">
                        {c.email}
                      </a>
                    )}
                    {c.phone && <p className="text-xs text-slate-500">{c.phone}</p>}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(c.tags || []).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setActiveTag(t.toLowerCase())}
                          className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 hover:text-blue-300"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-3">
                    {c.newsletter ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/30 text-green-300 border border-green-700/50">Subscribed</span>
                    ) : (
                      <span className="text-xs text-slate-600">No</span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-right whitespace-nowrap">
                    <Link href={`/dashboard/contacts/${c.id}`} className="text-xs text-blue-400 hover:text-blue-300 mr-3">
                      Profile
                    </Link>
                    <button type="button" onClick={() => setAddTo(c)} className="text-xs text-blue-400 hover:text-blue-300 mr-3">
                      Add to deal
                    </button>
                    <button type="button" onClick={() => setEditing(c)} className="text-xs text-blue-400 hover:text-blue-300">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No contacts match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500 max-w-2xl">
        Relay doesn&rsquo;t send newsletters. Mark people who agreed to hear from you, then export the list into Mailchimp, Constant Contact, or any email tool.
        Only add people who have said yes, and keep an unsubscribe link in every email you send.
      </p>

      {addTo && <AddContactToDealModal person={addTo} onClose={() => setAddTo(null)} />}

      {editing && (
        <ContactEditModal
          contact={editing === 'new' ? null : editing}
          organizations={contacts.filter((c) => c.contact_type === 'organization')}
          hasTeam={hasTeam}
          defaults={editing === 'new' && teamMode ? { shared: true } : undefined}
          isOwner={editing === 'new' || editing.is_mine !== false}
          onClose={() => setEditing(null)}
          onAuthError={handleAuth}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {showSync && (
        <SyncContactsModal
          tags={[...new Set(contacts.filter((c) => c.is_mine !== false).flatMap((c) => c.tags || []))].sort()}
          onClose={() => setShowSync(false)}
          onDone={async () => {
            await load();
          }}
          onAuthError={handleAuth}
        />
      )}

      {showDupes && (
        <DuplicateContactsModal
          onClose={() => setShowDupes(false)}
          onMerged={async () => {
            await load();
            await loadFollowUps();
            flash('Contacts merged.');
          }}
          onAuthError={handleAuth}
        />
      )}
    </div>
  );
}
