// Webhook signing secrets get pasted into hosting dashboards by hand, and a
// stray space, newline or pair of quotes makes every signature check fail
// with "Invalid signature". Clean the value before using it.
export function cleanWebhookSecret(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  return raw.trim().replace(/^["']+|["']+$/g, '').replace(/\s+/g, '');
}

// Describes the SHAPE of a secret for logs without revealing it.
export function describeSecretShape(raw: string | undefined): string {
  if (!raw) return 'missing';
  const cleaned = cleanWebhookSecret(raw) || '';
  return JSON.stringify({
    rawLength: raw.length,
    cleanedLength: cleaned.length,
    startsWithWhsec: cleaned.startsWith('whsec_'),
    hadWhitespaceOrQuotes: cleaned !== raw,
  });
}
