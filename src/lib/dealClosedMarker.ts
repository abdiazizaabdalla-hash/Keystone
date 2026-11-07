/** Chat lines written by the app when a deal closes start with this; the deal chat shows them as a banner, not a bubble. */
export const CLOSED_MESSAGE_PREFIX = '✅ Deal closed by ';

export const isClosedMessage = (body: string | null | undefined) => typeof body === 'string' && body.startsWith(CLOSED_MESSAGE_PREFIX);

/** "✅ Deal closed by Pat on Nov 6, 2026" -> { who: 'Pat', when: 'Nov 6, 2026' } */
export function parseClosedMessage(body: string): { who: string; when: string } {
  const rest = body.slice(CLOSED_MESSAGE_PREFIX.length);
  const i = rest.lastIndexOf(' on ');
  return i === -1 ? { who: rest, when: '' } : { who: rest.slice(0, i), when: rest.slice(i + 4) };
}
