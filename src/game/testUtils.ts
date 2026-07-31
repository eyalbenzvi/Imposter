/**
 * Test-only helpers for driving the reducer through a full game.
 * Kept in `game/` because it only touches the pure layer.
 */

import { createInitialState, reducer } from './reducer';
import { aliveIds, currentVoter, voteTargetsFor } from './rules';
import type { GameState, PlayerId, Settings } from './types';

export const NAMES = [
  'אבי',
  'בני',
  'גילי',
  'דנה',
  'הילה',
  'ורד',
  'זיו',
  'חן',
  'טל',
  'יעל',
  'כרמל',
  'ליאור',
];

export function names(count: number): string[] {
  return NAMES.slice(0, count);
}

/** Start a game and walk every player through the reveal screens. */
export function startedGame(
  playerCount = 5,
  settings: Partial<Settings> = {},
  seed = 'seed-alpha',
): GameState {
  let state = createInitialState(names(playerCount), settings);
  state = reducer(state, { type: 'START_GAME', seed });
  while (state.phase === 'REVEAL') {
    state = reducer(state, { type: 'SHOW_ROLE' });
    state = reducer(state, { type: 'HIDE_ROLE' });
  }
  return state;
}

/** Speak-mode clue round, straight through to DISCUSSION. */
export function playClueRound(state: GameState): GameState {
  let next = state;
  while (next.phase === 'CLUES') {
    next = reducer(next, { type: 'NEXT_CLUE_TURN' });
  }
  return next;
}

/** Everyone votes for `target`; `target` itself votes for the first other option. */
export function voteOut(state: GameState, target: PlayerId): GameState {
  let next = reducer(state, { type: 'START_VOTING' });
  next = castAll(next, target);
  return next;
}

/** Cast every remaining vote at `target` (the target votes elsewhere). */
export function castAll(state: GameState, target: PlayerId): GameState {
  let next = state;
  while (next.phase === 'VOTING') {
    const voter = currentVoter(next);
    if (voter === null) break;
    const options = voteTargetsFor(next, voter);
    const pick = voter === target ? options[0]! : target;
    next = reducer(next, { type: 'CAST_VOTE', voter, target: pick });
  }
  return next;
}

/** Cast votes from an explicit voter → target map. */
export function castVotes(
  state: GameState,
  plan: Record<PlayerId, PlayerId>,
): GameState {
  let next = state;
  while (next.phase === 'VOTING') {
    const voter = currentVoter(next);
    if (voter === null) break;
    const target = plan[voter];
    if (!target) throw new Error(`castVotes: no plan for ${voter}`);
    next = reducer(next, { type: 'CAST_VOTE', voter, target });
  }
  return next;
}

/** Discussion → vote out `target` → resolve the result. */
export function ejectPlayer(
  state: GameState,
  target: PlayerId,
  seed = 'seed-continue',
): GameState {
  const voted = voteOut(state, target);
  return reducer(voted, { type: 'CONTINUE', seed });
}

export function imposterOf(state: GameState): PlayerId {
  const id = state.imposterIds[0];
  if (!id) throw new Error('no imposter dealt');
  return id;
}

export function citizensOf(state: GameState): PlayerId[] {
  return state.players.filter((p) => !p.isImposter).map((p) => p.id);
}

export function aliveCitizens(state: GameState): PlayerId[] {
  return state.players.filter((p) => p.alive && !p.isImposter).map((p) => p.id);
}

export { aliveIds };
