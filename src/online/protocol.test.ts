import { describe, expect, it } from 'vitest';
import {
  HEARTBEAT_MS,
  PROTOCOL_VERSION,
  SILENCE_TIMEOUT_MS,
  parseGuestMessage,
  parseHostMessage,
} from './protocol';
import { RECONNECT_BUDGET_MS } from './retry';

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
      // Keyless on purpose: two players renaming in the same tick would
      // otherwise reject each other over a sync key neither of them moved.
      { t: 'RENAME', name: 'דנה' },
      { t: 'PING' },
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
      { t: 'JOIN', v: 1, name: 'דנה', seatId: 's4', token: 9 },
      { t: 'RENAME' },
      { t: 'RENAME', name: 5 },
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

  it('carries the seat token through, and only as a string', () => {
    expect(
      parseGuestMessage({ t: 'JOIN', v: 1, name: 'x', seatId: 's4', token: 'abc' }),
    ).toEqual({ t: 'JOIN', v: 1, name: 'x', seatId: 's4', token: 'abc' });
    // Absent is legitimate — a first join has no seat and no token.
    expect(parseGuestMessage({ t: 'JOIN', v: 1, name: 'x' })).not.toHaveProperty('token');
  });

  it('does not forge a rejection reason it was not given', () => {
    // `on` decides whether a refusal is terminal (`useGuest`'s TERMINAL set)
    // and whether it reverts a rename, so a missing one must not slide through
    // as undefined.
    expect(parseHostMessage({ t: 'REJECTED', reason: 'STALE', key: null })).toBeNull();
    expect(
      parseHostMessage({ t: 'REJECTED', reason: 'STALE', key: null, on: 'NOPE' }),
    ).toBeNull();
  });
});

describe('parseHostMessage', () => {
  it('accepts what the host actually sends', () => {
    expect(parseHostMessage({ t: 'WELCOME', v: 1, seatId: 's2', token: 'k' })).not.toBeNull();
    expect(parseHostMessage({ t: 'VIEW', view: { key: '1' } })).not.toBeNull();
    expect(
      parseHostMessage({ t: 'REJECTED', reason: 'STALE', key: '4', on: 'VOTE' }),
    ).not.toBeNull();
    expect(parseHostMessage({ t: 'CLOSED', reason: 'HOST_LEFT' })).not.toBeNull();
    expect(parseHostMessage({ t: 'PING' })).not.toBeNull();
    // The one that ends a reconnect war — it has to survive the wire, or the
    // displaced guest reads it as an ordinary drop and dials straight back.
    expect(
      parseHostMessage({ t: 'REJECTED', reason: 'SEAT_TAKEN', key: null, on: 'JOIN' }),
    ).toEqual({ t: 'REJECTED', reason: 'SEAT_TAKEN', key: null, on: 'JOIN' });
  });

  it('rejects the rest', () => {
    for (const msg of [null, 3, {}, { t: 'VIEW' }, { t: 'WELCOME', v: 1 }]) {
      expect(parseHostMessage(msg), JSON.stringify(msg)).toBeNull();
    }
  });

  it('refuses a rejection reason it has no words for', () => {
    // Dropped rather than passed through: `REJECT_TEXT[reason]` would be
    // undefined, and the player would be shown a refusal screen with nothing
    // written on it.
    expect(
      parseHostMessage({ t: 'REJECTED', reason: 'INVENTED', key: null, on: 'JOIN' }),
    ).toBeNull();
  });
});

/**
 * The timing constants are not independent — several of the transport's
 * guarantees are relationships between them, and a change to one in isolation
 * has broken those relationships before.
 */
describe('the timing constants agree with each other', () => {
  /**
   * Both sides treat "the interval was late" as "we were asleep" and skip a
   * round rather than reap. That guard is `HEARTBEAT_MS * 2`, so the silence
   * timeout has to leave room for it — otherwise a single late tick is
   * indistinguishable from a peer that has genuinely gone.
   */
  it('leaves room for a late tick before calling anyone silent', () => {
    expect(SILENCE_TIMEOUT_MS).toBeGreaterThan(HEARTBEAT_MS * 2);
  });

  /** Several heartbeats must be missed, not one, before a peer is written off. */
  it('needs more than one missed heartbeat to declare silence', () => {
    expect(SILENCE_TIMEOUT_MS / HEARTBEAT_MS).toBeGreaterThanOrEqual(3);
  });

  /**
   * A guest has to keep chasing for longer than the host takes to notice they
   * are gone, or they give up before the host has even marked the seat free.
   */
  it('gives a guest longer to come back than the host takes to notice', () => {
    expect(RECONNECT_BUDGET_MS).toBeGreaterThan(SILENCE_TIMEOUT_MS * 4);
  });
});
