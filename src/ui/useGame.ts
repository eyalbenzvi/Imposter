/**
 * The single bridge between React and the pure game layer.
 *
 * The UI never computes a rule — it dispatches. This hook's only extra job is
 * the impure part the reducer is forbidden to do: minting a random seed and
 * talking to localStorage.
 */

import { useCallback, useEffect, useReducer, useState } from 'react';
import { createInitialState, reducer } from '../game/reducer';
import type { Action, GameState } from '../game/types';
import { clearGame, loadGame, loadNames, loadSettings, saveSnapshot } from './storage';

/** Fresh randomness for every action that needs it. */
export function newSeed(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function bootstrap(): GameState {
  const restored = loadGame();
  if (restored) return restored;
  return createInitialState(loadNames(), loadSettings());
}

export type Game = {
  state: GameState;
  dispatch: (action: Action) => void;
  /** Dispatch an action that needs randomness, with a freshly minted seed. */
  dispatchSeeded: (
    type:
      | 'START_GAME'
      | 'ANOTHER_CLUE_ROUND'
      | 'START_VOTING'
      | 'CONTINUE'
      | 'NEW_ROUND',
  ) => void;
  /** Set when a dispatch was rejected, so the UI can say why. */
  error: string | null;
  clearError: () => void;
  reset: () => void;
};

export function useGame(): Game {
  const [error, setError] = useState<string | null>(null);

  const [state, rawDispatch] = useReducer(
    (current: GameState, action: Action): GameState => {
      try {
        return reducer(current, action);
      } catch (err) {
        // A rejected action must never take the group's game down with it.
        const message = err instanceof Error ? err.message : String(err);
        console.error('[imposter] rejected action', action, err);
        queueMicrotask(() => setError(message));
        return current;
      }
    },
    undefined,
    bootstrap,
  );

  useEffect(() => {
    saveSnapshot(state);
  }, [state]);

  const dispatch = useCallback((action: Action) => {
    setError(null);
    rawDispatch(action);
  }, []);

  const dispatchSeeded = useCallback(
    (
      type:
        | 'START_GAME'
        | 'ANOTHER_CLUE_ROUND'
        | 'START_VOTING'
        | 'CONTINUE'
        | 'NEW_ROUND',
    ) => {
      setError(null);
      rawDispatch({ type, seed: newSeed() } as Action);
    },
    [],
  );

  const reset = useCallback(() => {
    clearGame();
    setError(null);
    rawDispatch({ type: 'BACK_TO_SETUP' });
  }, []);

  return {
    state,
    dispatch,
    dispatchSeeded,
    error,
    clearError: useCallback(() => setError(null), []),
    reset,
  };
}
