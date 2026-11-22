import { supabaseServer } from './supabase';

import type { AiReadFeature, AiFailureReason } from './aiFailureLabels';
export { AI_FEATURE_LABEL, AI_FAILURE_LABEL } from './aiFailureLabels';
export type { AiReadFeature, AiFailureReason } from './aiFailureLabels';

/**
 * Records that an AI document read did not work for someone (see add-ai-failures.sql), so the Admin panel can show it.
 * Never throws and never blocks the request: if the table has not been created yet this only logs a console error.
 * Stores the reason, the file name and size, and a short technical note. Never the contents of the document.
 */
export async function logAiFailure(
  userId: string,
  feature: AiReadFeature,
  reason: AiFailureReason,
  info: { detail?: unknown; fileName?: string | null; fileBytes?: number | null } = {}
): Promise<void> {
  try {
    const detail = info.detail instanceof Error ? info.detail.message : typeof info.detail === 'string' ? info.detail : null;
    const { error } = await supabaseServer.from('ai_read_failures').insert({
      user_id: userId,
      feature,
      reason,
      detail: detail ? detail.slice(0, 300) : null,
      file_name: info.fileName ? String(info.fileName).slice(0, 200) : null,
      file_bytes: typeof info.fileBytes === 'number' && Number.isFinite(info.fileBytes) ? Math.round(info.fileBytes) : null,
    });
    if (error) console.error('AI failure log failed:', error.message);
  } catch (err) {
    console.error('AI failure log failed:', err);
  }
}
