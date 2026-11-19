import { describe, expect, it } from 'vitest';
import { CLOSED_MESSAGE_PREFIX, isClosedMessage, parseClosedMessage } from '@/lib/dealClosedMarker';

describe('deal-closed chat line', () => {
  it('is recognised and split into who and when', () => {
    const body = `${CLOSED_MESSAGE_PREFIX}Pat Lee on Nov 6, 2026`;
    expect(isClosedMessage(body)).toBe(true);
    expect(parseClosedMessage(body)).toEqual({ who: 'Pat Lee', when: 'Nov 6, 2026' });
  });
  it('keeps a name that contains " on "', () => {
    expect(parseClosedMessage(`${CLOSED_MESSAGE_PREFIX}Jon on Call Realty on Nov 6, 2026`)).toEqual({ who: 'Jon on Call Realty', when: 'Nov 6, 2026' });
  });
  it('does not treat an ordinary message as a closing', () => {
    expect(isClosedMessage('Deal closed by the way, thanks')).toBe(false);
    expect(isClosedMessage(null)).toBe(false);
  });
});
