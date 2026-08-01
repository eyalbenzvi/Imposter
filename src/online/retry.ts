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
 * Sized against the events it has to survive. A host who *reloads* is the easy
 * one: peerjs-server holds their abandoned id for about sixty seconds and they
 * reclaim it within three of its release. The one that sets the number is a
 * host who takes a phone call or swipes the app away and comes back — far
 * commoner at a party than a deliberate refresh, and easily two minutes.
 *
 * Nothing on the host's side is pushing back. A seat whose player has merely
 * gone quiet is kept, not freed, for the whole six-hour session; this number is
 * the only thing that ends the wait. And the guest is never trapped by it —
 * every reconnecting screen has a way out.
 */
export const RECONNECT_BUDGET_MS = 150_000;

/**
 * How long to wait before each attempt.
 *
 * The tail is 10s rather than 6s because every attempt is a *fresh* peer: a
 * new WebSocket to the shared public broker and a new id registration. Eleven
 * guests knocked off together by a host app-switch would otherwise produce
 * around ninety registrations in ninety seconds, all from one wifi's IP — a
 * poor thing to aim at a free service, and one whose punishment (being rate
 * limited) outlives the outage that caused it.
 */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 6_000, 8_000, 10_000];

export type RetryState = {
  /** Have we ever been given a seat in this room? */
  seatedOnce: boolean;
  /** Failed attempts so far in the current outage. */
  attempt: number;
  /** When the current outage began, on the local clock. */
  since: number;
};

/**
 * A number in [0, 1) that spreads simultaneous retries apart.
 *
 * Passed in rather than drawn here, because this module is pure and its tests
 * depend on that. Without it every guest in the room backs off on the same
 * schedule and they all knock at once, which is exactly the burst the longer
 * tail above is trying to avoid.
 */
export type Jitter = number;

export type RetryDecision =
  | { action: 'RETRY'; delayMs: number }
  | { action: 'GIVE_UP'; clearSession: boolean };

export function nextRetry(
  state: RetryState,
  why: ConnectFailure,
  now: number,
  jitter: Jitter = 0.5,
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
    return { action: 'RETRY', delayMs: delayFor(state.attempt, jitter) };
  }

  // Never seated. No amount of waiting conjures up a room that does not exist.
  if (why === 'NO_ROOM' || state.attempt >= MAX_DIAL_ATTEMPTS) {
    // A session pointing at a room that never answered would send this phone
    // straight back to the same dead screen on every launch.
    return { action: 'GIVE_UP', clearSession: why === 'NO_ROOM' };
  }
  return { action: 'RETRY', delayMs: delayFor(state.attempt, jitter) };
}

/** The step for this attempt, spread across ±40% so a room does not knock in unison. */
function delayFor(attempt: number, jitter: Jitter): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
  return Math.round(base * (0.6 + jitter * 0.8));
}
