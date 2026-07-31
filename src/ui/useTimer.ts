/**
 * A countdown that lives entirely in the UI.
 *
 * Time deliberately never reaches the reducer — an expired timer only nudges
 * the group to move on, it never advances the game by itself.
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
  toggle: () => void;
};

export function useTimer(totalSeconds: number, autoStart = false): Timer {
  const enabled = totalSeconds > 0;
  const [remaining, setRemaining] = useState(totalSeconds);
  const [running, setRunning] = useState(enabled && autoStart);
  const deadline = useRef<number | null>(null);

  useEffect(() => {
    setRemaining(totalSeconds);
    setRunning(totalSeconds > 0 && autoStart);
    deadline.current = null;
  }, [totalSeconds, autoStart]);

  useEffect(() => {
    if (!enabled || !running) return;

    // Anchor to a wall-clock deadline so a backgrounded tab doesn't drift.
    if (deadline.current === null) {
      deadline.current = Date.now() + remaining * 1000;
    }
    const tick = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline.current! - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        setRunning(false);
        deadline.current = null;
      }
    }, 250);

    return () => window.clearInterval(tick);
  }, [enabled, running, remaining]);

  const start = useCallback(() => {
    if (!enabled) return;
    setRunning(true);
  }, [enabled]);

  const pause = useCallback(() => {
    setRunning(false);
    deadline.current = null;
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    deadline.current = null;
    setRemaining(totalSeconds);
  }, [totalSeconds]);

  const toggle = useCallback(() => {
    setRunning((was) => {
      if (was) deadline.current = null;
      return !was;
    });
  }, []);

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
