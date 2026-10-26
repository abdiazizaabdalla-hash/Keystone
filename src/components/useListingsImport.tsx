'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { authFetch } from '@/lib/authClient';
import { parseCsv, parseDate, parsePrice } from '@/lib/csvImport';

// CSV import for the listings side, shared by the Listings page and the Listings card on the dashboard.
// Reads the file in the browser, sends the rows to /api/listings/import-csv, and keeps an "Undo import"
// banner up for 2 minutes (the server enforces the same window).

const UNDO_WINDOW_MS = 2 * 60 * 1000;
const LAST_IMPORT_KEY = 'relay.listings.lastImport';
const BATCH = 200;

interface LastImport {
  ids: string[];
  at: number;
}

const countdownLabel = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

// Column headers vary a lot between MLS exports and spreadsheets, so each field lists the exact names it
// answers to first, then phrases it may be contained in. A column is only used for one field.
function mapColumns(head: string[]) {
  const used = new Set<number>();
  const pick = (exact: string[], contains: string[] = [], exclude?: RegExp) => {
    let i = head.findIndex((h, n) => !used.has(n) && exact.includes(h));
    if (i < 0) i = head.findIndex((h, n) => !used.has(n) && contains.some((c) => h.includes(c)) && !(exclude && exclude.test(h)));
    if (i >= 0) used.add(i);
    return i;
  };
  const address = pick(['property address', 'address', 'street address', 'listing address', 'property', 'street'], ['address', 'property'], /e-?mail|mailing|billing/);
  const sellerEmail = pick(['seller email', 'owner email', 'client email', 'email'], ['seller e', 'owner e', 'email', 'e-mail']);
  const sellerPhone = pick(['seller phone', 'owner phone', 'client phone', 'phone', 'mobile', 'cell'], ['phone', 'mobile', 'cell']);
  const mls = pick(['mls', 'mls #', 'mls number', 'mls id', 'mls no', 'mls#'], ['mls']);
  const price = pick(['list price', 'listing price', 'asking price', 'price'], ['price']);
  const expiration = pick(['expiration date', 'expiration', 'expires', 'expiry', 'listing expiration', 'end date'], ['expir']);
  const planned = pick(['list date', 'planned list date', 'listing date', 'go live', 'go-live', 'start date', 'listing start', 'on market'], ['list date', 'listing date', 'listed', 'go live', 'start']);
  const status = pick(['status', 'listing status'], ['status']);
  const notes = pick(['notes', 'note', 'comments', 'comment'], ['note', 'comment']);
  const seller = pick(['seller name', 'seller', 'owner', 'owner name', 'client name', 'client', 'name'], ['seller', 'owner', 'client']);
  return { address, seller, sellerEmail, sellerPhone, mls, price, expiration, planned, status, notes };
}

export function useListingsImport(onChanged: () => void | Promise<void>) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lastImport, setLastImport] = useState<LastImport | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [undoing, setUndoing] = useState(false);

  const remember = useCallback((v: LastImport | null) => {
    setLastImport(v);
    try {
      if (v) window.localStorage.setItem(LAST_IMPORT_KEY, JSON.stringify(v));
      else window.localStorage.removeItem(LAST_IMPORT_KEY);
    } catch {
      /* the undo button still works on this page */
    }
  }, []);

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

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setNotice('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('That file is over 5 MB.');
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) throw new Error('Could not find any rows. The first row should have column names like Address, Seller and List price.');
      const head = parsed[0].map((h) => h.trim().toLowerCase());
      const col = mapColumns(head);
      if (col.address < 0) throw new Error('Could not find an Address column. Name the column Address or Property address.');
      const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
      const rows = parsed
        .slice(1)
        .map((r) => ({
          propertyAddress: get(r, col.address),
          sellerName: get(r, col.seller),
          sellerEmail: get(r, col.sellerEmail),
          sellerPhone: get(r, col.sellerPhone),
          mlsNumber: get(r, col.mls),
          listPrice: parsePrice(get(r, col.price)) || '',
          expirationDate: parseDate(get(r, col.expiration)) || '',
          plannedListDate: parseDate(get(r, col.planned)) || '',
          status: get(r, col.status),
          notes: get(r, col.notes),
        }))
        .filter((r) => r.propertyAddress);
      if (rows.length === 0) throw new Error('No rows had an address.');

      setWorking(true);
      let added = 0;
      let dup = 0;
      let bad = 0;
      const ids: string[] = [];
      for (let i = 0; i < rows.length; i += BATCH) {
        const res = await authFetch('/api/listings/import-csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: rows.slice(i, i + BATCH) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Import failed');
        added += data.added;
        dup += data.skippedDuplicate;
        bad += data.skippedInvalid;
        if (Array.isArray(data.ids)) ids.push(...data.ids);
      }
      if (ids.length > 0) {
        remember({ ids, at: Date.now() });
        setNow(Date.now());
      }
      setNotice(
        `Added ${added} listing${added === 1 ? '' : 's'} with your starter checklist. ${dup} already open in Relay, ${bad} skipped (no address). Nobody was emailed.`
      );
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setWorking(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const undo = async () => {
    if (!lastImport || undoing) return;
    setUndoing(true);
    setError('');
    try {
      const res = await authFetch('/api/listings/import-csv/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: lastImport.ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not undo the import');
      remember(null);
      setNotice(
        `Import undone: removed ${data.removed} listing${data.removed === 1 ? '' : 's'}.` +
          (data.kept ? ` ${data.kept} were left because you already changed them or added offers or documents.` : '') +
          (data.expired ? ` ${data.expired} could not be removed because the 2 minutes were up.` : '')
      );
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not undo the import');
    } finally {
      setUndoing(false);
    }
  };

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept=".csv,text/csv"
      className="hidden"
      aria-label="Import listings from a CSV file"
      onChange={(e) => void importFile(e.target.files?.[0])}
    />
  );

  const banner: ReactNode =
    error || notice || lastImport ? (
      <div className="space-y-2">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-green-400">{notice}</p>}
        {lastImport && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm text-slate-200" role="status">
            <span>
              Imported {lastImport.ids.length} listing{lastImport.ids.length === 1 ? '' : 's'}. Changed your mind?
            </span>
            <button
              type="button"
              onClick={undo}
              disabled={undoing}
              className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
            >
              {undoing ? 'Undoing…' : 'Undo import'}
            </button>
            <span className="text-xs text-slate-400">{countdownLabel(lastImport.at + UNDO_WINDOW_MS - now)} left</span>
          </div>
        )}
      </div>
    ) : null;

  return { openPicker: () => fileRef.current?.click(), input, banner, working };
}
