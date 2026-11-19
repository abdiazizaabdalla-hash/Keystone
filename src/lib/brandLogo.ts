import { supabaseServer } from './supabase';
import { MAX_LOGO_BYTES, sniffLogo, type LogoKind } from './logoFormat';

// A person's logo, printed at the top of every PDF they send (invoices, commission statements, compliance reports).
// Kept in the private documents bucket under branding/<user id>/logo, so no new storage setup is needed.
// PDF files take PNG and JPEG only, so those are the formats accepted.

const BUCKET = 'transaction-documents';
const pathFor = (userId: string) => `branding/${userId}/logo`;

export async function saveLogo(userId: string, bytes: Buffer): Promise<LogoKind> {
  const kind = sniffLogo(bytes);
  if (!kind) throw new Error('Use a PNG or JPEG image.');
  if (bytes.length > MAX_LOGO_BYTES) throw new Error('That image is over 1 MB. Use a smaller one.');
  const { error } = await supabaseServer.storage.from(BUCKET).upload(pathFor(userId), bytes, { contentType: kind === 'png' ? 'image/png' : 'image/jpeg', upsert: true });
  if (error) throw error;
  return kind;
}

export async function removeLogo(userId: string): Promise<void> {
  await supabaseServer.storage.from(BUCKET).remove([pathFor(userId)]);
}

/** The logo's bytes, or null when there isn't one. Never throws: a missing logo must not stop a PDF from being made. */
export async function loadLogo(userId: string | null | undefined): Promise<Buffer | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabaseServer.storage.from(BUCKET).download(pathFor(userId));
    if (error || !data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    return sniffLogo(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

export async function logoPreviewUrl(userId: string): Promise<string | null> {
  const { data } = await supabaseServer.storage.from(BUCKET).createSignedUrl(pathFor(userId), 60 * 60);
  return data?.signedUrl ?? null;
}
