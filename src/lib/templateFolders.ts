import { AuthError } from './auth';
import { supabaseServer } from './supabase';
import { loadOwnTemplate } from './templatesServer';
import { findFormSource } from './stateFormSources';

export const FOLDER_ITEM_KINDS = ['template', 'trec', 'source'] as const;
export type FolderItemKind = (typeof FOLDER_ITEM_KINDS)[number];
export const MAX_FOLDERS = 30;
export const MAX_ITEMS_PER_FOLDER = 100;

export function cleanFolderName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (!name) throw new AuthError('Give the folder a name.', 400);
  return name;
}

/** The folder, only if it is yours. */
export async function loadOwnFolder(id: string, ownerId: string) {
  const { data, error } = await supabaseServer.from('template_folders').select('id, name, created_at').eq('id', id).eq('owner_user_id', ownerId).maybeSingle();
  if (error) throw error;
  if (!data) throw new AuthError('Folder not found.', 404);
  return data as { id: string; name: string; created_at: string };
}

/** What can go in a folder: one of your templates, a Texas TREC form, or a listed state forms source. */
export async function checkFolderItem(kind: FolderItemKind, ref: string, ownerId: string) {
  if (kind === 'template') {
    await loadOwnTemplate(ref, ownerId);
  } else if (kind === 'trec') {
    const { data } = await supabaseServer.from('trec_forms').select('slug').eq('slug', ref).maybeSingle();
    if (!data) throw new AuthError('That TREC form is not in the list.', 404);
  } else if (!findFormSource(ref)) {
    throw new AuthError('That forms source is not in the list.', 404);
  }
}

export function isDuplicateName(error: unknown) {
  return !!error && typeof error === 'object' && (error as { code?: string }).code === '23505';
}
