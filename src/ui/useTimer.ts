/**
 * A countdown that lives entirely in the UI.
 *
 * Time deliberately never reaches the reducer — an expired timer only nudges
 * the group to move on, it never advances the game by itself.
 *
 * The clock is driven by a wall-clock deadline in a ref rather than by
 * decrementing state, so a backgrounded tab doesn't drift. Two things follow
 * from that and are easy to get wrong:
 *
 *  • Whoever starts the clock arms the deadline itself. A `reset()` followed by
 *    a `start()` in the same tick round-trips `running` back to its current
 *    value, so React can skip the re-render entirely — if arming were left to
 *    the interval effect, the deadline would stay null and the still-live
 *    interval would read it as "already expired" and slam the clock to zero.
 *  • The interval depends only on `running`, never on `remaining`, so it isn't
 *    torn down and rebuilt several times a second.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type Timer = {
  /** Whole seconds left, or null when no timer is configured. */
  remaining: number | null;
  running: boolean;
  expired: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
  /** Pause, resume, or — once expired — hand the group a fresh clock. */
  toggle: () => void;
};

export function useTimer(totalSeconds: number, autoStart = false): Timer {
  const enabled = totalSeconds > 0;
  const [remaining, setRemaining] = useState(totalSeconds);
  const [running, setRunning] = useState(enabled && autoStart);
  const deadline = useRef<number | null>(null);
  // Mirror of `remaining`, so callbacks can arm a deadline without going stale.
  const remainingRef = useRef(totalSeconds);
  remainingRef.current = remaining;

  const arm = useCallback((seconds: number) => {
    deadline.current = Date.now() + seconds * 1000;
  }, []);

  // A change of duration is a whole new clock.
  useEffect(() => {
    const shouldRun = totalSeconds > 0 && autoStart;
    setRemaining(totalSeconds);
    remainingRef.current = totalSeconds;
    deadline.current = shouldRun ? Date.now() + totalSeconds * 1000 : null;
    setRunning(shouldRun);
  }, [totalSeconds, autoStart]);

  useEffect(() => {
    if (!enabled || !running) return;
    if (deadline.current === null) arm(remainingRef.current);

    const tick = (): void => {
      const end = deadline.current;
      if (end === null) return;
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        deadline.current = null;
        setRunning(false);
      }
    };

    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [enabled, running, arm]);

  const start = useCallback(() => {
    if (!enabled) return;
    const from = remainingRef.current > 0 ? remainingRef.current : totalSeconds;
    setRemaining(from);
    remainingRef.current = from;
    arm(from);
    setRunning(true);
  }, [enabled, totalSeconds, arm]);

  const pause = useCallback(() => {
    setRunning(false);
    deadline.current = null;
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    deadline.current = null;
    setRemaining(totalSeconds);
    remainingRef.current = totalSeconds;
  }, [totalSeconds]);

  const toggle = useCallback(() => {
    if (!enabled) return;
    if (running) {
      pause();
      return;
    }
    start();
  }, [enabled, running, pause, start]);

  return {
    remaining: enabled ? remaining : null,
    running,
    expired: enabled && remaining === 0,
    start,
    pause,
    reset,
    toggle,
  };
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
