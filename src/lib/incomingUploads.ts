import crypto from 'crypto';
import { supabaseServer } from '@/lib/supabase';

// Direct-to-storage uploads for listing files. A browser can't push a big PDF through a serverless
// function (Vercel stops request bodies at about 4.5 MB), so the page asks for a one-time signed upload
// URL, sends the file straight to private storage, and then tells the server only WHERE it put it.
//
// Safety rules, all enforced here and not by the browser:
//  - every upload lands under listing-incoming/<user id>/ and a server route only ever reads paths under
//    the CALLING user's own folder, so nobody can point a request at someone else's file;
//  - the file name and type are checked before a URL is issued, and the URL is for that exact path;
//  - the size is checked on the stored object BEFORE it is downloaded;
//  - nothing here is permanent: the route that uses the file copies it to its real home and removes it,
//    and the daily cleanup job deletes anything left over after a day.

export const INCOMING_BUCKET = 'transaction-documents';
export const INCOMING_ROOT = 'listing-incoming';
export const MAX_INCOMING_SIZE = 25 * 1024 * 1024;
/** How many unused incoming files one user can have waiting at once (they are cleared after a day). */
export const MAX_INCOMING_WAITING = 40;

/** Same allowlist as the Documents tab: no scripts, HTML/SVG or archives. */
export const LISTING_FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  rtf: 'application/rtf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

export function extensionOf(name: string): string {
  return (name.toLowerCase().split('.').pop() || '').replace(/[^a-z0-9]/g, '');
}

export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'file';
}

/** Issues a signed upload URL for one file in the caller's own incoming folder. */
export async function createIncomingUpload(userId: string, name: string, size: number) {
  const ext = extensionOf(name);
  if (!LISTING_FILE_TYPES[ext]) throw new IncomingError(`${name}: that file type is not allowed. Use PDF, Word, Excel, text or an image.`);
  if (!Number.isFinite(size) || size <= 0) throw new IncomingError(`${name}: the file is empty`);
  if (size > MAX_INCOMING_SIZE) throw new IncomingError(`${name} is over the 25MB limit`);
  const path = `${INCOMING_ROOT}/${userId}/${crypto.randomUUID()}-${safeFileName(name)}`;
  const { data, error } = await supabaseServer.storage.from(INCOMING_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw error || new Error('Could not create an upload link');
  return { name, path, token: data.token };
}

export class IncomingError extends Error {
  status = 400;
}

/** True only for a path inside this user's own incoming folder. */
export function isOwnIncomingPath(userId: string, path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length < 400 &&
    path.startsWith(`${INCOMING_ROOT}/${userId}/`) &&
    !path.includes('..') &&
    !path.slice(`${INCOMING_ROOT}/${userId}/`.length).includes('/')
  );
}

/**
 * Reads a file the caller uploaded to their incoming folder. `displayName` is what the TC called it
 * (cleaned); the type is decided by its extension against `allowed`, never by what the browser said.
 */
export async function readIncomingFile(userId: string, path: unknown, displayName: unknown, allowed: Record<string, string>): Promise<File> {
  if (!isOwnIncomingPath(userId, path)) throw new IncomingError('That upload could not be found. Please add the file again.');
  const base = path.split('/').pop() as string;
  const dir = path.slice(0, path.lastIndexOf('/'));

  // Size first, from storage's own record of the object.
  const { data: listed } = await supabaseServer.storage.from(INCOMING_BUCKET).list(dir, { limit: 5, search: base });
  const meta = (listed || []).find((o) => o.name === base);
  const size = Number((meta?.metadata as { size?: number } | null)?.size ?? NaN);
  if (!meta) throw new IncomingError('That upload could not be found. Please add the file again.');
  if (Number.isFinite(size) && size > MAX_INCOMING_SIZE) {
    await removeIncoming([path]);
    throw new IncomingError('That file is over the 25MB limit.');
  }

  const name = (typeof displayName === 'string' && displayName.trim() ? displayName.trim() : base.replace(/^[0-9a-f-]{36}-/, '')).slice(0, 300);
  const ext = extensionOf(name) || extensionOf(base);
  if (!allowed[ext]) throw new IncomingError(`${name}: that file type is not allowed here.`);
  // The stored object's own extension must agree with what we were told it is.
  if (extensionOf(base) !== ext) throw new IncomingError(`${name}: the file type does not match.`);

  const { data: blob, error } = await supabaseServer.storage.from(INCOMING_BUCKET).download(path);
  if (error || !blob) throw new IncomingError('That upload could not be read. Please add the file again.');
  if (blob.size > MAX_INCOMING_SIZE) {
    await removeIncoming([path]);
    throw new IncomingError('That file is over the 25MB limit.');
  }
  return new File([blob], name, { type: allowed[ext] });
}

export async function removeIncoming(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabaseServer.storage.from(INCOMING_BUCKET).remove(paths);
  } catch (error) {
    console.error('Failed to remove incoming upload (ignored):', error);
  }
}

export type ParsedUpload = {
  files: File[];
  /** Incoming storage paths that were read (empty for small multipart uploads). Remove these once finished. */
  incomingPaths: string[];
  /** A text field from the request, whichever way it was sent. Objects sent as JSON come back as JSON text. */
  field: (name: string) => string | null;
};

/**
 * Reads the files for a request in either form:
 *  - JSON  { uploads: [{ path, name }], ...fields }  — files already sent straight to storage (any size up to 25MB each)
 *  - multipart form-data with `files` / `file`          — small files sent through the server (kept for compatibility)
 * Either way the caller gets ordinary File objects and the same field accessor.
 */
export async function parseUploadRequest(
  request: Request,
  userId: string,
  allowed: Record<string, string>,
  maxFiles: number
): Promise<ParsedUpload> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new IncomingError('Could not read the request');
    }
    if (!body || typeof body !== 'object') throw new IncomingError('Could not read the request');
    const uploads = Array.isArray(body.uploads) ? body.uploads : [];
    if (uploads.length > maxFiles) throw new IncomingError(`Add up to ${maxFiles} files at a time`);
    const seen = new Set<string>();
    const files: File[] = [];
    const incomingPaths: string[] = [];
    for (const u of uploads) {
      const item = (u || {}) as { path?: unknown; name?: unknown };
      if (typeof item.path !== 'string' || seen.has(item.path)) throw new IncomingError('That upload could not be found. Please add the file again.');
      seen.add(item.path);
      files.push(await readIncomingFile(userId, item.path, item.name, allowed));
      incomingPaths.push(item.path);
    }
    return {
      files,
      incomingPaths,
      field: (name) => {
        const v = body[name];
        if (v === undefined || v === null) return null;
        return typeof v === 'string' ? v : JSON.stringify(v);
      },
    };
  }
  const form = await request.formData();
  const files = [...form.getAll('files'), ...form.getAll('file')].filter((f): f is File => f instanceof File);
  if (files.length > maxFiles) throw new IncomingError(`Add up to ${maxFiles} files at a time`);
  for (const f of files) {
    const ext = extensionOf(f.name);
    if (!allowed[ext]) throw new IncomingError(`${f.name}: that file type is not allowed here.`);
    if (f.size > MAX_INCOMING_SIZE) throw new IncomingError(`${f.name} is over the 25MB limit`);
  }
  return {
    files,
    incomingPaths: [],
    field: (name) => {
      const v = form.get(name);
      return typeof v === 'string' ? v : null;
    },
  };
}

/** Daily cleanup: removes incoming uploads nobody used (older than `maxAgeMs`). Returns how many were removed. */
export async function purgeStaleIncoming(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const bucket = supabaseServer.storage.from(INCOMING_BUCKET);
  let removed = 0;
  const { data: folders, error } = await bucket.list(INCOMING_ROOT, { limit: 1000 });
  if (error) throw error;
  for (const folder of folders || []) {
    if (folder.id) continue; // a loose file at the root is not expected; folders have no id
    const dir = `${INCOMING_ROOT}/${folder.name}`;
    for (let pass = 0; pass < 20; pass++) {
      const { data: files, error: listError } = await bucket.list(dir, { limit: 100, sortBy: { column: 'created_at', order: 'asc' } });
      if (listError) throw listError;
      if (!files || files.length === 0) break;
      const stale = files.filter((f) => f.created_at && new Date(f.created_at).getTime() < cutoff).map((f) => `${dir}/${f.name}`);
      if (stale.length === 0) break;
      const { error: rmError } = await bucket.remove(stale);
      if (rmError) throw rmError;
      removed += stale.length;
      if (files.length < 100) break;
    }
  }
  return removed;
}

/** How many incoming files this user already has waiting. */
export async function countIncoming(userId: string): Promise<number> {
  const { data } = await supabaseServer.storage.from(INCOMING_BUCKET).list(`${INCOMING_ROOT}/${userId}`, { limit: MAX_INCOMING_WAITING + 1 });
  return (data || []).filter((o) => o.id).length;
}
