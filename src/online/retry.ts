/**
 * How long a guest keeps chasing a room, and when it stops.
 *
 * One budget is not enough, because the two situations look identical to the
 * code and are opposites to the player:
 *
 *  • **First dial.** They typed a code. If it does not answer, the likely
 *    reason is a wrong code or a room that has ended, and the useful thing is
 *    to say so within a few seconds rather than spin.
 *  • **A reconnect while seated.** They are standing in the room, their seat is
 *    still in it, and the outage is somebody's wifi or the host's phone
 *    switching apps. Giving up here throws them out of a game they are playing.
 *
 * The trap the first version fell into: classifying a failure as `NO_ROOM` and
 * treating that as terminal *for a seated player too*. But `NO_ROOM` is exactly
 * what the broker answers while the host's signalling socket is down — the
 * host's game is running fine and the room will be routable again in seconds.
 * So for a seated guest the classification is ignored and only the clock
 * decides.
 */

import type { ConnectFailure } from './peer';

/** A first dial gets one retry — about thirteen seconds, then an answer. */
export const MAX_DIAL_ATTEMPTS = 1;

/**
 * Once seated, keep chasing for this long.
 *
 * Sized against the two events it has to survive: peerjs-server holds an
 * abandoned id for about 60 seconds, and a host who reloads needs that plus
 * their own startup.
 */
export const RECONNECT_BUDGET_MS = 90_000;

export const BACKOFF_MS = [1_000, 2_000, 4_000, 6_000, 6_000, 6_000];

export type RetryState = {
  /** Have we ever been given a seat in this room? */
  seatedOnce: boolean;
  /** Failed attempts so far in the current outage. */
  attempt: number;
  /** When the current outage began, on the local clock. */
  since: number;
};

export type RetryDecision =
  | { action: 'RETRY'; delayMs: number }
  | { action: 'GIVE_UP'; clearSession: boolean };

export function nextRetry(
  state: RetryState,
  why: ConnectFailure,
  now: number,
): RetryDecision {
  if (state.seatedOnce) {
    // The classification is deliberately ignored. See the note above: a seated
    // player's `NO_ROOM` means the host fell off the broker, not that the room
    // is gone — and their seat is still in it.
    if (now - state.since > RECONNECT_BUDGET_MS) {
      // Never wipe a seated player's session. It is what gets them back into
      // the room, and the room may well still be there.
      return { action: 'GIVE_UP', clearSession: false };
    }
    return { action: 'RETRY', delayMs: delayFor(state.attempt) };
  }

  // Never seated. No amount of waiting conjures up a room that does not exist.
  if (why === 'NO_ROOM' || state.attempt >= MAX_DIAL_ATTEMPTS) {
    // A session pointing at a room that never answered would send this phone
    // straight back to the same dead screen on every launch.
    return { action: 'GIVE_UP', clearSession: why === 'NO_ROOM' };
  }
  return { action: 'RETRY', delayMs: delayFor(state.attempt) };
}

function delayFor(attempt: number): number {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
}
