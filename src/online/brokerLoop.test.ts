import { describe, expect, it, vi } from 'vitest';
import {
  FIRST_DELAY_MS,
  GIVE_UP_AFTER_MS,
  MAX_DELAY_MS,
  makeBrokerLoop,
  nextDelay,
} from './brokerLoop';

/**
 * A hand-cranked clock, so the loop's timing can be asserted rather than waited
 * for. Nothing here touches a real timer or a real Peer — the arithmetic was
 * never the risky part, the machine around it was.
 */
function clock() {
  let next = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  let now = 0;
  return {
    now: () => now,
    pending: () => timers.size,
    setTimeout(fn: () => void, ms: number) {
      const id = next++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    /** Run every timer due at or before `now + ms`, in order. */
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
  };
}

function setup(
  overrides: Partial<{ dead: boolean; disconnected: boolean; open: boolean }> = {},
) {
  const c = clock();
  // `open` defaults to the mirror of `disconnected`, which is what a peer that
  // is simply up or simply down looks like — so every test written before the
  // two were told apart keeps meaning what it meant.
  const state = {
    dead: false,
    disconnected: true,
    open: !(overrides.disconnected ?? true),
    ...overrides,
  };
  const reconnect = vi.fn();
  const onState = vi.fn();
  const loop = makeBrokerLoop({
    reconnect,
    isDead: () => state.dead,
    isDisconnected: () => state.disconnected,
    isOpen: () => state.open,
    now: c.now,
    setTimeout: c.setTimeout,
    clearTimeout: c.clearTimeout,
    onState,
  });
  return { c, state, reconnect, onState, loop };
}

describe('the broker recovery loop', () => {
  it('retries after the first delay', () => {
    const { c, reconnect, loop } = setup();
    loop.down();
    expect(reconnect).not.toHaveBeenCalled();
    c.advance(FIRST_DELAY_MS);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  /**
   * PeerJS's `_abort` emits `'error'` and then `'disconnected'` for one
   * failure, so this is reached twice as a matter of course. Two chains would
   * double the traffic and race each other.
   */
  it('arms one timer however many times it is told the socket is down', () => {
    const { c, loop } = setup();
    loop.down();
    loop.down();
    loop.down();
    expect(c.pending()).toBe(1);
  });

  it('backs off, and stops backing off at the ceiling', () => {
    const { c, reconnect, loop } = setup();
    loop.down();
    for (let i = 0; i < 8; i++) c.advance(MAX_DELAY_MS);
    expect(reconnect.mock.calls.length).toBeGreaterThan(3);
    expect(nextDelay(MAX_DELAY_MS)).toBe(MAX_DELAY_MS);
  });

  it('cancels and resets the backoff when the socket comes back', () => {
    const { c, reconnect, onState, loop } = setup();
    loop.down();
    c.advance(FIRST_DELAY_MS * 4);
    const before = reconnect.mock.calls.length;

    loop.up();
    expect(c.pending()).toBe(0);
    c.advance(MAX_DELAY_MS);
    expect(reconnect).toHaveBeenCalledTimes(before);
    expect(onState).toHaveBeenLastCalledWith('UP');

    // And the next outage starts from the short delay again, not the long one.
    loop.down();
    c.advance(FIRST_DELAY_MS);
    expect(reconnect.mock.calls.length).toBe(before + 1);
  });

  /**
   * `peer.destroy()` emits `'disconnected'` on its way out. Without `stop()`
   * being final, closing the room would arm the loop against a corpse — and
   * `reconnect()` on a destroyed peer throws.
   */
  it('stays stopped once stopped, even if told the socket dropped', () => {
    const { c, reconnect, loop } = setup();
    loop.stop();
    loop.down();
    expect(c.pending()).toBe(0);
    c.advance(MAX_DELAY_MS);
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('cancels a retry that was already armed when it stops', () => {
    const { c, reconnect, loop } = setup();
    loop.down();
    expect(c.pending()).toBe(1);
    loop.stop();
    expect(c.pending()).toBe(0);
    c.advance(MAX_DELAY_MS);
    expect(reconnect).not.toHaveBeenCalled();
  });

  /**
   * The guards have to sit in the timer callback, not at the call site: at the
   * moment `'disconnected'` fires, `peer.destroyed` is still false.
   */
  it('does not call reconnect on a peer that died after the timer was armed', () => {
    const { c, state, reconnect, loop } = setup();
    loop.down();
    state.dead = true;
    c.advance(FIRST_DELAY_MS);
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('does not call reconnect on a peer that is no longer disconnected', () => {
    // `reconnect()` throws on a connected peer just as it does on a dead one.
    const { c, state, reconnect, loop } = setup();
    loop.down();
    state.disconnected = false;
    c.advance(FIRST_DELAY_MS);
    expect(reconnect).not.toHaveBeenCalled();
  });

  /**
   * The loop has to be able to conclude on its own that everything is fine.
   *
   * Callers arm it defensively — on a tab resume, on any post-open error —
   * without knowing whether the socket is actually down. When the only route
   * back to `UP` was an `'open'` event, a peer that was never really down never
   * emitted one, and the host spent the rest of the evening on the degraded
   * banner with the room code hidden behind it.
   */
  it('finds its own way back to UP when the socket turns out to be fine', () => {
    const { c, state, onState, loop } = setup();
    loop.down();
    expect(onState).toHaveBeenLastCalledWith('DOWN');

    state.disconnected = false;
    state.open = true;
    c.advance(FIRST_DELAY_MS);

    expect(onState).toHaveBeenLastCalledWith('UP');
    expect(c.pending()).toBe(0);
  });

  it('says nothing when it was never down in the first place', () => {
    const { c, state, onState, loop } = setup({ disconnected: false });
    loop.up();
    c.advance(MAX_DELAY_MS);
    expect(onState).not.toHaveBeenCalled();
    expect(state.disconnected).toBe(false);
  });

  /**
   * The give-up clock measures the outage, not the sum of the waits that were
   * *about to* happen. Accumulating the next delay before comparing retired the
   * loop nine seconds early, and — worse — did it on a budget that drifted with
   * every ceiling-length wait.
   */
  it('keeps trying for the whole budget, on the real clock', () => {
    const { c, reconnect, loop } = setup();
    loop.down();
    // Two thirds of the way through: still going.
    c.advance(GIVE_UP_AFTER_MS * (2 / 3));
    const midway = reconnect.mock.calls.length;
    expect(c.pending()).toBe(1);

    c.advance(GIVE_UP_AFTER_MS);
    expect(reconnect.mock.calls.length).toBeGreaterThan(midway);
    expect(c.pending()).toBe(0);
  });

  it('survives a reconnect that throws and tries again', () => {
    const { c, reconnect, loop } = setup();
    reconnect.mockImplementation(() => {
      throw new Error('not disconnected');
    });
    loop.down();
    expect(() => c.advance(FIRST_DELAY_MS)).not.toThrow();
    c.advance(MAX_DELAY_MS);
    expect(reconnect.mock.calls.length).toBeGreaterThan(1);
  });

  it('reports the state change exactly once per transition', () => {
    const { onState, loop } = setup();
    loop.down();
    loop.down();
    expect(onState.mock.calls.filter(([s]) => s === 'DOWN')).toHaveLength(1);
    loop.up();
    expect(onState.mock.calls.filter(([s]) => s === 'UP')).toHaveLength(1);
  });

  /**
   * The regression that made the loop useless against a broker that accepts
   * nothing.
   *
   * `peer.reconnect()` clears the disconnected flag **synchronously**, before
   * the WebSocket is even constructed. Reading that as "we are back" meant the
   * loop declared victory a second or two into every attempt: the banner
   * flickered on and off, the backoff never grew past its first step, and the
   * give-up budget was reset before it could ever fire — so a host on bad wifi
   * hammered the shared public broker for the rest of the evening.
   *
   * This io models peerjs honestly: `reconnect()` clears `disconnected` and
   * leaves `open` false until the socket answers, which here it never does.
   */
  it('does not mistake a reconnect in flight for a recovery', () => {
    const c = clock();
    const state = { disconnected: true, open: false };
    const reconnect = vi.fn(() => {
      // Exactly what peerjs does, and the whole trap.
      state.disconnected = false;
    });
    const onState = vi.fn();
    const loop = makeBrokerLoop({
      reconnect,
      isDead: () => false,
      isDisconnected: () => state.disconnected,
      isOpen: () => state.open,
      now: c.now,
      setTimeout: c.setTimeout,
      clearTimeout: c.clearTimeout,
      onState,
    });

    loop.down();
    // Five minutes of a socket that is never going to answer.
    for (let i = 0; i < 30; i++) c.advance(MAX_DELAY_MS);

    // One DOWN, and never a false UP.
    expect(onState.mock.calls.map(([s]) => s)).toEqual(['DOWN']);
    // And it concluded rather than spinning for the rest of the evening.
    expect(c.pending()).toBe(0);
    expect(reconnect.mock.calls.length).toBeLessThan(20);
  });

  it('still declares recovery the moment the socket is genuinely open', () => {
    const c = clock();
    const state = { disconnected: true, open: false };
    const onState = vi.fn();
    const loop = makeBrokerLoop({
      reconnect: () => {
        state.disconnected = false;
      },
      isDead: () => false,
      isDisconnected: () => state.disconnected,
      isOpen: () => state.open,
      now: c.now,
      setTimeout: c.setTimeout,
      clearTimeout: c.clearTimeout,
      onState,
    });

    loop.down();
    c.advance(FIRST_DELAY_MS); // reconnect fires, socket still answering
    expect(onState.mock.calls.map(([s]) => s)).toEqual(['DOWN']);

    state.open = true; // the server said OPEN
    c.advance(MAX_DELAY_MS);

    expect(onState.mock.calls.map(([s]) => s)).toEqual(['DOWN', 'UP']);
    expect(c.pending()).toBe(0);
  });

  /** A code somebody else has taken fails identically forever. */
  it('gives up rather than spinning at the ceiling for the rest of the evening', () => {
    const { c, reconnect, loop } = setup();
    loop.down();
    for (let i = 0; i < 40; i++) c.advance(MAX_DELAY_MS);
    const settled = reconnect.mock.calls.length;
    c.advance(MAX_DELAY_MS * 10);
    expect(reconnect.mock.calls.length).toBe(settled);
    expect(c.pending()).toBe(0);
  });

  /**
   * Giving up is not the end of it: the host coming back to the tab arms the
   * loop again. That attempt has to be prompt — a foregrounded tab is the most
   * likely moment for the socket to come back — and it was twenty seconds away
   * because the backoff was left parked at the ceiling.
   */
  it('tries again promptly if it is told the socket is down after giving up', () => {
    const { c, reconnect, loop } = setup();
    loop.down();
    for (let i = 0; i < 40; i++) c.advance(MAX_DELAY_MS);
    const settled = reconnect.mock.calls.length;

    loop.down();
    c.advance(FIRST_DELAY_MS);
    expect(reconnect.mock.calls.length).toBe(settled + 1);
  });

  /**
   * …and it gets a whole fresh budget, not one grudging attempt. The budget is
   * for an outage that will never end; a host coming back to the tab is a new
   * situation and deserves to be treated as one.
   */
  it('starts the budget over rather than re-tripping the old one', () => {
    const { c, reconnect, loop } = setup();
    loop.down();
    for (let i = 0; i < 40; i++) c.advance(MAX_DELAY_MS);
    const settled = reconnect.mock.calls.length;

    loop.down();
    c.advance(GIVE_UP_AFTER_MS / 2);
    // Several attempts into the new outage, not one and then silence.
    expect(reconnect.mock.calls.length).toBeGreaterThan(settled + 3);
    expect(c.pending()).toBe(1);
  });
});
