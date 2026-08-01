import { describe, expect, it } from 'vitest';
import { RECONNECT_BUDGET_MS, nextRetry, type RetryState } from './retry';

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
  it('grows and then holds steady', () => {
    const delays = [0, 1, 2, 3, 4, 9].map((attempt) => {
      const out = nextRetry(seated({ attempt }), 'NETWORK', NOW);
      return out.action === 'RETRY' ? out.delayMs : -1;
    });
    expect(delays[0]).toBeLessThan(delays[2]!);
    expect(delays[5]).toBe(delays[4]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(6_000);
  });
});
