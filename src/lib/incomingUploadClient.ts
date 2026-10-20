import { authFetch } from '@/lib/authClient';
import { supabaseBrowser } from '@/lib/supabaseClient';

export interface UploadedFile {
  name: string;
  path: string;
}

const BUCKET = 'transaction-documents';

/**
 * Sends files straight to private storage (no size limit from the app server) and returns where they landed.
 * Pass the result's `path`/`name` pairs to the route that reads them (offers, documents, listing agreement).
 */
export async function uploadIncoming(files: File[]): Promise<UploadedFile[]> {
  if (files.length === 0) return [];
  const res = await authFetch('/api/listings/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: files.map((f) => ({ name: f.name, size: f.size })) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not start the upload');
  const uploads = data.uploads as { name: string; path: string; token: string }[];
  const out: UploadedFile[] = [];
  for (let i = 0; i < uploads.length; i++) {
    const { error } = await supabaseBrowser.storage.from(BUCKET).uploadToSignedUrl(uploads[i].path, uploads[i].token, files[i]);
    if (error) throw new Error(`${files[i].name}: the upload failed. ${error.message}`);
    out.push({ name: files[i].name, path: uploads[i].path });
  }
  return out;
}
