import { describe, expect, it } from 'vitest';
import { BACKOFF_MS, RECONNECT_BUDGET_MS, nextRetry, type RetryState } from './retry';

const NOW = 1_000_000;

const dialing = (over: Partial<RetryState> = {}): RetryState => ({
  seatedOnce: false,
  attempt: 0,
  since: NOW,
  ...over,
});

const seated = (over: Partial<RetryState> = {}): RetryState => ({
  seatedOnce: true,
  attempt: 0,
  since: NOW,
  ...over,
});

describe('a first dial', () => {
  it('retries a network failure once, then says so', () => {
    expect(nextRetry(dialing(), 'NETWORK', NOW)).toMatchObject({ action: 'RETRY' });
    expect(nextRetry(dialing({ attempt: 1 }), 'NETWORK', NOW)).toMatchObject({
      action: 'GIVE_UP',
    });
  });

  it('does not retry a room that does not exist', () => {
    // No amount of waiting conjures one up, and telling the player to wait is
    // a lie — the likely cause is a code typed wrong.
    expect(nextRetry(dialing(), 'NO_ROOM', NOW)).toEqual({
      action: 'GIVE_UP',
      clearSession: true,
    });
  });

  /**
   * A session pointing at a room that never answered is what sends the app
   * back into the online mode on the next launch — straight to the same dead
   * screen, every time.
   */
  it('forgets a session that pointed at a room that never was', () => {
    const out = nextRetry(dialing(), 'NO_ROOM', NOW);
    expect(out).toMatchObject({ clearSession: true });
  });

  it('keeps the session when it merely could not reach the network', () => {
    expect(nextRetry(dialing({ attempt: 5 }), 'TIMEOUT', NOW)).toMatchObject({
      clearSession: false,
    });
  });
});

describe('a reconnect by somebody who is already seated', () => {
  /**
   * The sequence this exists for, and the one the first version got wrong.
   *
   * When the host's signalling socket drops, its data channels survive but the
   * broker stops routing the room code — so a guest whose channel blips in that
   * window is told `peer-unavailable`, which classifies as NO_ROOM. Their seat
   * is still in the room and the host is still playing. Treating that as
   * terminal ejected them from a game they were standing in, and wiped the
   * session that would have got them back.
   */
  it('keeps trying through NO_ROOM, because the room is probably still there', () => {
    expect(nextRetry(seated(), 'NO_ROOM', NOW + 1_000)).toMatchObject({
      action: 'RETRY',
    });
  });

  it('keeps trying well past the point a first dial would have given up', () => {
    expect(nextRetry(seated({ attempt: 12 }), 'NETWORK', NOW + 30_000)).toMatchObject({
      action: 'RETRY',
    });
  });

  it('gives up on the clock, not the attempt count', () => {
    expect(
      nextRetry(seated({ attempt: 1 }), 'NETWORK', NOW + RECONNECT_BUDGET_MS + 1),
    ).toMatchObject({ action: 'GIVE_UP' });
  });

  /**
   * The budget has to outlast the two events it exists for: peerjs-server holds
   * an abandoned id for about sixty seconds, and a host who reloads needs that
   * plus their own startup.
   */
  it('outlasts a host reload and the id being reaped', () => {
    expect(RECONNECT_BUDGET_MS).toBeGreaterThan(60_000);
    expect(nextRetry(seated(), 'NETWORK', NOW + 75_000)).toMatchObject({
      action: 'RETRY',
    });
  });

  it('never wipes the session — it is how they get back in', () => {
    const out = nextRetry(seated(), 'NO_ROOM', NOW + RECONNECT_BUDGET_MS + 1);
    expect(out).toEqual({ action: 'GIVE_UP', clearSession: false });
  });
});

describe('the backoff', () => {
  /** No jitter, so the shape of the curve can be asserted exactly. */
  const flat = (attempt: number): number => {
    const out = nextRetry(seated({ attempt }), 'NETWORK', NOW, 0.5);
    return out.action === 'RETRY' ? out.delayMs : -1;
  };

  it('grows and then holds steady', () => {
    const delays = [0, 1, 2, 3, 4, 5, 9].map(flat);
    expect(delays[0]).toBeLessThan(delays[2]!);
    // The tail holds: attempt 5 and attempt 9 wait the same.
    expect(delays[6]).toBe(delays[5]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(10_000);
  });

  /**
   * Every attempt is a *fresh* peer — a new WebSocket to the shared public
   * broker and a new id registration. Eleven guests knocked off together by a
   * host app-switch would otherwise all knock at the same instants, and the
   * punishment for that (being rate limited) outlives the outage that caused it.
   */
  it('spreads simultaneous retries apart', () => {
    const spread = [0, 0.25, 0.5, 0.75, 0.999].map((j) => {
      const out = nextRetry(seated({ attempt: 3 }), 'NETWORK', NOW, j);
      return out.action === 'RETRY' ? out.delayMs : -1;
    });
    expect(new Set(spread).size).toBe(spread.length);
    // Never zero, and never more than the step itself by much.
    expect(Math.min(...spread)).toBeGreaterThan(0);
    expect(Math.max(...spread)).toBeLessThanOrEqual(BACKOFF_MS[3]! * 1.4);
  });

  it('defaults to the middle of the range, so a caller may ignore it', () => {
    const out = nextRetry(seated(), 'NETWORK', NOW);
    expect(out).toMatchObject({ action: 'RETRY', delayMs: BACKOFF_MS[0] });
  });

  /**
   * The budget has to outlast the events it exists for, and a host taking a
   * phone call is a far commoner party event than a deliberate refresh. The
   * host keeps a silent seat indefinitely, so nothing on that side ends the
   * wait — only this number does.
   */
  it('outlasts a host who took a phone call', () => {
    expect(RECONNECT_BUDGET_MS).toBeGreaterThan(120_000);
  });
});
