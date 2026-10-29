import { supabaseServer } from './supabase';

export type AiFeature = 'contract' | 'listing_agreement' | 'offer';

/**
 * Records one AI document read in ai_usage (see add-ai-usage.sql): who, which
 * feature, which model and how many tokens. Never throws and never blocks the
 * request -- if the table hasn't been created yet this just logs a console
 * error. No document contents are stored.
 */
export async function logAiUsage(
  userId: string,
  feature: AiFeature,
  model: string,
  usage: { input_tokens?: number | null; output_tokens?: number | null } | null | undefined
): Promise<void> {
  try {
    const { error } = await supabaseServer.from('ai_usage').insert({
      user_id: userId,
      feature,
      model,
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
    });
    if (error) console.error('AI usage log failed:', error.message);
  } catch (err) {
    console.error('AI usage log failed:', err);
  }
}
