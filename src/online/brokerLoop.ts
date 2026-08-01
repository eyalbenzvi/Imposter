/**
 * Keeping the host's signalling socket alive.
 *
 * When the WebSocket to the broker drops, PeerJS *disconnects* the peer rather
 * than destroying it: existing data channels keep working, and it never
 * reconnects on its own. So the game carries on for the people already in the
 * room while the room code quietly stops being routable — nobody new can join,
 * and the host has no idea. That is the failure this loop exists to end.
 *
 * It is a separate file, with every effect injected, because the arithmetic was
 * never the hard part. `min(1000 * 2^n, 20s)` has never been wrong. What is
 * hard is the machine around it, and all four of the ways a naive version goes
 * wrong come straight out of how PeerJS behaves:
 *
 *  • `peer.reconnect()` THROWS on a destroyed peer, and throws again on one
 *    that is not currently disconnected. It cannot be called optimistically.
 *  • `peer.destroy()` emits `'disconnected'` on its way out. Wire the loop to
 *    that event naively and closing the room *arms* it against a corpse.
 *  • Inside the `'disconnected'` handler, `peer.destroyed` is still false. A
 *    guard there is worthless; it has to sit in the timer callback.
 *  • PeerJS's `_abort` emits `'error'` and then `'disconnected'`, so a single
 *    failure arrives twice and would arm two overlapping chains.
 */

export type BrokerState = 'UP' | 'DOWN';

export type BrokerLoop = {
  /** The socket went away. Arms the retry, unless one is already armed. */
  down(): void;
  /** The socket is back. Cancels the retry and resets the backoff. */
  up(): void;
  /** Permanent teardown. Cancels, and every later `down()` is a no-op. */
  stop(): void;
  /** Testing/diagnostics: is a retry currently scheduled? */
  armed(): boolean;
};

export type BrokerIo = {
  /** May throw — the loop has to survive it. */
  reconnect(): void;
  isDead(): boolean;
  isDisconnected(): boolean;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  onState(state: BrokerState): void;
};

export const FIRST_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 20_000;

/**
 * How long to keep trying before calling it lost.
 *
 * Unbounded retries look harmless and are not: if somebody else has taken the
 * room code, `reconnect()` fails identically forever and the host sits at a
 * twenty-second spin with a code nobody can reach and nothing on screen.
 */
export const GIVE_UP_AFTER_MS = 120_000;

export function nextDelay(previous: number): number {
  return Math.min(previous * 2, MAX_DELAY_MS);
}

export function makeBrokerLoop(io: BrokerIo): BrokerLoop {
  let timer: number | null = null;
  let delay = FIRST_DELAY_MS;
  let stopping = false;
  let downSince: number | null = null;

  const cancel = (): void => {
    if (timer === null) return;
    io.clearTimeout(timer);
    timer = null;
  };

  const arm = (): void => {
    // One chain, always. `_abort` reports the same failure as both an error and
    // a disconnect, so this is reached twice per drop as a matter of course.
    if (stopping || timer !== null) return;
    timer = io.setTimeout(() => {
      timer = null;
      // Both guards live here rather than at the call site: at the moment the
      // event fired, `destroyed` was still false.
      if (stopping || io.isDead()) return;
      if (io.isDisconnected()) {
        try {
          io.reconnect();
        } catch {
          // Raced with a destroy, or PeerJS changed its mind about our state.
          // Either way the next tick re-evaluates from scratch.
        }
      }
      delay = nextDelay(delay);
      if (downSince !== null && elapsed() > GIVE_UP_AFTER_MS) return;
      arm();
    }, delay);
  };

  // The clock only exists inside `setTimeout`, so elapsed time is counted in
  // delays rather than read from a wall clock we were not given.
  let spent = 0;
  const elapsed = (): number => {
    spent += delay;
    return spent;
  };

  return {
    down() {
      if (stopping) return;
      if (downSince === null) {
        downSince = 1;
        spent = 0;
        io.onState('DOWN');
      }
      arm();
    },

    up() {
      cancel();
      delay = FIRST_DELAY_MS;
      spent = 0;
      const wasDown = downSince !== null;
      downSince = null;
      if (wasDown || !stopping) io.onState('UP');
    },

    stop() {
      stopping = true;
      cancel();
    },

    armed: () => timer !== null,
  };
}
