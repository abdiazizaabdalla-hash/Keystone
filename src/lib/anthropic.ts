import Anthropic from '@anthropic-ai/sdk';

// Server-side Anthropic client for AI-assisted features (currently just
// contract intake -- see /api/transactions/extract-contract). Lazily
// constructed so importing this module never throws in an environment
// where ANTHROPIC_API_KEY isn't set yet (local dev before it's
// configured); the error only surfaces when a route actually tries to
// use it, with a message that says exactly what's missing.
let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set -- AI contract intake is unavailable until it is configured.'
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// Model used for contract-field extraction. Sonnet rather than Haiku --
// this is reading a legal document for price/date/party accuracy, and
// it runs once per transaction creation, not at volume, so the extra
// cost over Haiku is worth it for the better accuracy. Overridable via
// env so it can be swapped without a code change if pricing/models shift.
export const CONTRACT_EXTRACTION_MODEL = process.env.ANTHROPIC_EXTRACTION_MODEL || 'claude-sonnet-5-5';
