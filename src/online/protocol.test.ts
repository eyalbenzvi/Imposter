import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, parseGuestMessage, parseHostMessage } from './protocol';

/**
 * Anything arriving off a data channel is untrusted — an older build, a
 * half-written blob, or somebody poking at the console. Nothing reaches the
 * driver without going through here first.
 */
describe('parseGuestMessage', () => {
  it('accepts every well-formed intent', () => {
    const good: unknown[] = [
      { t: 'JOIN', v: PROTOCOL_VERSION, name: 'דנה' },
      { t: 'JOIN', v: PROTOCOL_VERSION, name: 'דנה', seatId: 's3' },
      { t: 'LEAVE' },
      { t: 'READY', key: '7' },
      { t: 'CHOOSE', key: '7', option: 'VOTE' },
      { t: 'CHOOSE', key: '7', option: 'ANOTHER_ROUND' },
      { t: 'VOTE', key: '7', target: 'p2' },
      { t: 'CLUE', key: '7', text: 'חתול' },
      { t: 'NEXT_TURN', key: '7' },
      { t: 'SKIP_CLUES', key: '7' },
      { t: 'GUESS', key: '7', wordId: 'pizza' },
    ];
    for (const msg of good) {
      expect(parseGuestMessage(msg), JSON.stringify(msg)).not.toBeNull();
    }
  });

  it('rejects anything malformed', () => {
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'READY',
      [],
      {},
      { t: 'NOPE' },
      { t: 'READY' },
      { t: 'READY', key: 7 },
      { t: 'VOTE', key: '7' },
      { t: 'VOTE', key: '7', target: 3 },
      { t: 'CLUE', key: '7', text: null },
      { t: 'CHOOSE', key: '7', option: 'MAYBE' },
      { t: 'CHOOSE', key: '7' },
      { t: 'GUESS', key: '7' },
      { t: 'JOIN', name: 'דנה' },
      { t: 'JOIN', v: '1', name: 'דנה' },
      { t: 'JOIN', v: 1, name: 5 },
      { t: 'JOIN', v: 1, name: 'דנה', seatId: 9 },
    ];
    for (const msg of bad) {
      expect(parseGuestMessage(msg), JSON.stringify(msg)).toBeNull();
    }
  });

  it('drops fields it does not recognise rather than passing them through', () => {
    const parsed = parseGuestMessage({
      t: 'READY',
      key: '3',
      // A field an attacker (or a newer build) invented.
      forceAdvance: true,
    });
    expect(parsed).toEqual({ t: 'READY', key: '3' });
  });

  it('keeps seatId only when it is a string', () => {
    expect(parseGuestMessage({ t: 'JOIN', v: 1, name: 'x' })).toEqual({
      t: 'JOIN',
      v: 1,
      name: 'x',
    });
    expect(parseGuestMessage({ t: 'JOIN', v: 1, name: 'x', seatId: 's4' })).toEqual({
      t: 'JOIN',
      v: 1,
      name: 'x',
      seatId: 's4',
    });
    // A non-string seat id is a malformed message, not a missing field.
    expect(parseGuestMessage({ t: 'JOIN', v: 1, name: 'x', seatId: 4 })).toBeNull();
  });
});

describe('parseHostMessage', () => {
  it('accepts what the host actually sends', () => {
    expect(parseHostMessage({ t: 'WELCOME', v: 1, seatId: 's2' })).not.toBeNull();
    expect(parseHostMessage({ t: 'VIEW', view: { key: '1' } })).not.toBeNull();
    expect(
      parseHostMessage({ t: 'REJECTED', reason: 'STALE', key: '4', on: 'VOTE' }),
    ).not.toBeNull();
    expect(parseHostMessage({ t: 'CLOSED', reason: 'HOST_LEFT' })).not.toBeNull();
  });

  it('rejects the rest', () => {
    for (const msg of [null, 3, {}, { t: 'VIEW' }, { t: 'WELCOME', v: 1 }]) {
      expect(parseHostMessage(msg), JSON.stringify(msg)).toBeNull();
    }
  });
});
