// Browser-safe: no imports. The Admin screen reads these; aiFailures.ts (server only) re-exports them.
export type AiReadFeature = 'contract' | 'listing_agreement' | 'offer' | 'listing_contract';
export type AiFailureReason = 'unreadable' | 'not_a_document' | 'too_large' | 'wrong_type' | 'upload_error' | 'service_error' | 'not_configured' | 'rate_limited';

export const AI_FEATURE_LABEL: Record<string, string> = {
  contract: 'Contract (new transaction)',
  listing_agreement: 'Listing agreement',
  offer: 'Offer package',
  listing_contract: 'Contract (listing to deal)',
};

export const AI_FAILURE_LABEL: Record<string, string> = {
  unreadable: 'Could not be read (scan, damaged or unusual file)',
  not_a_document: 'Not the kind of document expected',
  too_large: 'File too large',
  wrong_type: 'Not a PDF',
  upload_error: 'Upload problem',
  service_error: 'AI service error',
  not_configured: 'AI reading not set up',
  rate_limited: 'Too many reads in an hour',
};
