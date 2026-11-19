import { isFeatureOn } from '../features';
import { getAnthropicClient } from '../anthropic';
import { logAiUsage } from '../aiUsage';
import { supabaseServer } from '../supabase';
import { AI_FEATURE, PROPOSAL_KINDS, runAssistant, type AiClient, type AssistantDeps, type AssistantResult } from './aiCore';

// Server wiring for the AI wrapper. Pure rules and the test fake live in aiCore.ts.
// Model is overridable by env; a smaller model is the default because this is classification and reading, not drafting.
export const AUTOMATION_MODEL = process.env.ANTHROPIC_AUTOMATION_MODEL || 'claude-haiku-5-5';
/** Default per-account monthly allowance (tokens). A placeholder until real cost data exists (decision D6); override by env. */
export const DEFAULT_MONTHLY_TOKEN_CAP = Number(process.env.AUTOMATION_MONTHLY_TOKEN_CAP) || 500_000;

const PROPOSALS_TOOL = {
  name: 'record_proposals',
  description: 'Record structured proposals. A person reviews them; nothing here is executed automatically.',
  input_schema: {
    type: 'object' as const,
    properties: {
      proposals: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...PROPOSAL_KINDS] },
            text: { type: 'string' },
            taskId: { type: 'string' },
            reason: { type: 'string' },
            documentId: { type: 'string' },
            category: { type: 'string' },
            documentType: { type: 'string' },
            confidence: { type: 'number' },
            field: { type: 'string', enum: ['acceptance_date', 'closing_date'] },
            date: { type: 'string', description: 'YYYY-MM-DD' },
          },
          required: ['kind'],
        },
      },
    },
    required: ['proposals'],
  },
};

export const anthropicAiClient: AiClient = {
  async propose({ system, prompt, model }) {
    const response = await getAnthropicClient().messages.create({
      model,
      max_tokens: 1500,
      system,
      tools: [PROPOSALS_TOOL],
      tool_choice: { type: 'tool', name: PROPOSALS_TOOL.name },
      messages: [{ role: 'user', content: prompt }],
    });
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    return { raw: toolUse && toolUse.type === 'tool_use' ? toolUse.input : null, usage: response.usage };
  },
};

/** Tokens used on automation by an owner since the start of the current UTC month. */
export async function tokensUsedThisMonth(ownerUserId: string, now: Date = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await supabaseServer.from('ai_usage').select('input_tokens, output_tokens').eq('user_id', ownerUserId).eq('feature', AI_FEATURE).gte('created_at', start);
  if (error) throw error;
  return (data ?? []).reduce((n, r) => n + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0);
}

export function defaultAssistantDeps(overrides: Partial<AssistantDeps> = {}): AssistantDeps {
  return {
    client: anthropicAiClient,
    model: AUTOMATION_MODEL,
    featureOn: isFeatureOn('automation'),
    tokensUsedThisMonth,
    monthlyTokenCap: DEFAULT_MONTHLY_TOKEN_CAP,
    logUsage: (ownerUserId, model, usage) => logAiUsage(ownerUserId, AI_FEATURE, model, usage),
    ...overrides,
  };
}

/** Convenience for callers: reads untrusted text with the real model, subject to the flag and the monthly cap. */
export function readUntrusted(input: { ownerUserId: string; task: string; untrustedText: string }): Promise<AssistantResult> {
  return runAssistant(input, defaultAssistantDeps());
}
