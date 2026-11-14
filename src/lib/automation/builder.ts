import { isFeatureOn } from '../features';
import { getAnthropicClient } from '../anthropic';
import { logAiUsage } from '../aiUsage';
import { DEFAULT_MONTHLY_TOKEN_CAP, tokensUsedThisMonth } from './ai';
import { BUILDER_FEATURE, draftAutomation, type BuilderClient, type BuilderDeps } from './builderCore';

// Server wiring for the AI builder. Drafting a whole workflow is worth a stronger model than reading documents is; override by env.
export const BUILDER_MODEL = process.env.ANTHROPIC_AUTOMATION_DRAFT_MODEL || 'claude-sonnet-5-5';

export const anthropicBuilderClient: BuilderClient = {
  async call({ system, prompt, model, tool }) {
    const response = await getAnthropicClient().messages.create({
      model,
      max_tokens: 3000,
      system,
      tools: [tool],
      // Sonnet-class models reject a forced tool choice, so ask for the tool in the prompt instead (as contract reading does).
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: `${prompt}\n\nAnswer only by calling the ${tool.name} tool.` }],
    });
    const toolUse = response.content.find((b) => b.type === 'tool_use');
    return { raw: toolUse && toolUse.type === 'tool_use' ? toolUse.input : null, usage: response.usage };
  },
};

export function defaultBuilderDeps(overrides: Partial<BuilderDeps> = {}): BuilderDeps {
  return {
    client: anthropicBuilderClient,
    model: BUILDER_MODEL,
    featureOn: isFeatureOn('automation'),
    tokensUsedThisMonth,
    monthlyTokenCap: DEFAULT_MONTHLY_TOKEN_CAP,
    logUsage: (ownerUserId, model, usage) => logAiUsage(ownerUserId, BUILDER_FEATURE, model, usage),
    ...overrides,
  };
}

export const draftWithAi = (input: Parameters<typeof draftAutomation>[0]) => draftAutomation(input, defaultBuilderDeps());
