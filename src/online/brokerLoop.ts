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
 * hard is the machine around it, and all of the ways a naive version goes
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
 *
 * And one that is ours rather than PeerJS's: the loop must be able to conclude
 * that things are **fine again** on its own. A caller can arm it defensively
 * without knowing whether anything is actually wrong, and if the only route
 * back to `UP` were an `'open'` event, a peer that was never really down would
 * be marked degraded for the rest of the evening.
 */

export type BrokerState = 'UP' | 'DOWN';

export type BrokerLoop = {
  /** The socket may have gone. Arms a retry, unless one is already armed. */
  down(): void;
  /** The socket is definitely back. Cancels the retry and resets the backoff. */
  up(): void;
  /** Permanent teardown. Cancels, and every later `down()` is a no-op. */
  stop(): void;
  /** Testing and diagnostics: is a retry currently scheduled? */
  armed(): boolean;
};

export type BrokerIo = {
  /** May throw — the loop has to survive it. */
  reconnect(): void;
  isDead(): boolean;
  isDisconnected(): boolean;
  now(): number;
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
  /** When the current outage started, or null while everything is fine. */
  let downSince: number | null = null;

  const cancel = (): void => {
    if (timer === null) return;
    io.clearTimeout(timer);
    timer = null;
  };

  const recovered = (): void => {
    cancel();
    delay = FIRST_DELAY_MS;
    if (downSince === null) return;
    downSince = null;
    io.onState('UP');
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

      // Not disconnected means there is nothing to recover — either the socket
      // came back by itself, or it never went. Either way this is the signal
      // that things are fine, and waiting for an `'open'` that will never be
      // emitted would leave the room marked degraded forever.
      if (!io.isDisconnected()) {
        recovered();
        return;
      }

      try {
        io.reconnect();
      } catch {
        // Raced with a destroy, or PeerJS changed its mind about our state.
        // The next tick re-evaluates from scratch.
      }

      if (downSince !== null && io.now() - downSince > GIVE_UP_AFTER_MS) return;
      delay = nextDelay(delay);
      arm();
    }, delay);
  };

  return {
    down() {
      if (stopping) return;
      if (downSince === null) {
        downSince = io.now();
        io.onState('DOWN');
      }
      arm();
    },

    up() {
      recovered();
    },

    stop() {
      stopping = true;
      cancel();
    },

    armed: () => timer !== null,
  };
}
