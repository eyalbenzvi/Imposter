/**
 * The one and only place game state changes.
 *
 * Hard rules (they are what makes a future online mode possible):
 *  1. Pure — same (state, action) always yields the same next state.
 *  2. No `Math.random()` and no `Date.now()`. Every random decision is derived
 *     from `action.seed` through the deterministic PRNG in `prng.ts`.
 *  3. The returned state is always fully JSON-serializable.
 *  4. Illegal (phase, action) pairs throw instead of being ignored.
 */

import {
  HINTS_PER_WORD,
  type Action,
  type ActionType,
  type GameState,
  type Phase,
  type Player,
  type Settings,
} from './types';
import { normalize } from './niqqud';
import { makeRng, subSeed } from './prng';
import {
  aliveIds,
  buildGuessOptions,
  checkWinner,
  currentVoter,
  drawTurnOrder,
  maxImposterCount,
  playerAtReveal,
  playerById,
  playerCountIsValid,
  resolveVote,
  suggestImposterCount,
  voteTargetsFor,
} from './rules';
import { WORDS, getWordEntry } from './words';

export class InvalidTransitionError extends Error {
  readonly phase: Phase;
  readonly action: ActionType;
  constructor(phase: Phase, action: ActionType) {
    super(`Invalid transition: cannot dispatch "${action}" during phase "${phase}"`);
    this.name = 'InvalidTransitionError';
    this.phase = phase;
    this.action = action;
  }
}

export class GameRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameRuleError';
  }
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'HIDDEN',
  clueMode: 'SPEAK',
  imposterCount: 1,
  discussionSeconds: 0,
  clueTimerSeconds: 0,
  imposterGuessEnabled: false,
};

export function createInitialState(
  names: string[] = [],
  settings: Partial<Settings> = {},
): GameState {
  const state: GameState = {
    phase: 'SETUP',
    settings: { ...DEFAULT_SETTINGS, ...settings },
    players: [],
    imposterIds: [],
    roundNumber: 0,
    secretWordId: null,
    hintIndex: null,
    hintWord: null,
    revealOrder: [],
    revealIndex: 0,
    revealShown: false,
    revealViews: {},
    turnOrder: [],
    discussionOrder: [],
    clueTurnIndex: 0,
    clues: {},
    voteStage: 'FIRST',
    eligibleTargets: [],
    voterOrder: [],
    voterIndex: 0,
    votes: [],
    lastVote: null,
    guessingImposterId: null,
    guessOptions: null,
    guessResult: null,
    winner: null,
  };
  return names.length > 0 ? setPlayers(state, names) : state;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function setPlayers(state: GameState, names: string[]): GameState {
  const players: Player[] = names.map((name, i) => ({
    id: `p${i}`,
    name: normalize(name.trim()),
    isImposter: false,
    alive: true,
  }));
  const imposterCount = Math.min(
    state.settings.imposterCount,
    maxImposterCount(Math.max(players.length, 1)),
  );
  return { ...state, players, settings: { ...state.settings, imposterCount } };
}

/**
 * Draw a word, one of its five hints, and the imposters — in a fixed order so
 * that adding a future draw cannot shift the existing ones.
 */
function dealRoles(state: GameState, seed: string): GameState {
  if (WORDS.length === 0) {
    throw new GameRuleError('The word store is empty — cannot start a game');
  }

  const entry = makeRng(subSeed(seed, 'word')).pick(WORDS);
  const hintIndex = makeRng(subSeed(seed, 'hint')).int(
    Math.min(entry.hints.length, HINTS_PER_WORD),
  );

  const ids = state.players.map((p) => p.id);
  const chosen = makeRng(subSeed(seed, 'imposters')).sample(
    ids,
    state.settings.imposterCount,
  );
  // Store in player order so the value is stable regardless of draw order.
  const imposterIds = ids.filter((id) => chosen.includes(id));

  const players = state.players.map((p) => ({
    ...p,
    alive: true,
    isImposter: imposterIds.includes(p.id),
  }));

  return {
    ...state,
    players,
    imposterIds,
    revealOrder: makeRng(subSeed(seed, 'revealOrder')).shuffle(ids),
    secretWordId: entry.id,
    hintIndex,
    // Both imposters receive this exact same substitute word.
    hintWord: entry.hints[hintIndex]!,
    revealViews: {},
    guessingImposterId: null,
    guessOptions: null,
    guessResult: null,
    winner: null,
    lastVote: null,
  };
}

/** Open a clue round: reshuffle the turn order and reset the voting slate. */
function startClueRound(state: GameState, seed: string, roundNumber: number): GameState {
  const living = aliveIds(state);
  return {
    ...state,
    phase: 'CLUES',
    roundNumber,
    turnOrder: drawTurnOrder(living, subSeed(seed, `turnOrder:${roundNumber}`)),
    // A separate draw from the clue order, so the discussion doesn't simply
    // repeat the sequence people just spoke in.
    discussionOrder: drawTurnOrder(
      living,
      subSeed(seed, `discussionOrder:${roundNumber}`),
    ),
    clueTurnIndex: 0,
    clues: {},
    voteStage: 'FIRST',
    eligibleTargets: living,
    voterOrder: drawTurnOrder(living, subSeed(seed, `voterOrder:${roundNumber}`)),
    voterIndex: 0,
    votes: [],
    lastVote: null,
  };
}

function requirePhase(state: GameState, action: Action, ...allowed: Phase[]): void {
  if (!allowed.includes(state.phase)) {
    throw new InvalidTransitionError(state.phase, action.type);
  }
}

// ── reducer ──────────────────────────────────────────────────────────────────

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'SET_PLAYERS': {
      requirePhase(state, action, 'SETUP');
      return setPlayers(state, action.names);
    }

    case 'UPDATE_SETTINGS': {
      requirePhase(state, action, 'SETUP');
      const merged = { ...state.settings, ...action.patch };
      if (state.players.length > 0) {
        merged.imposterCount = Math.min(
          Math.max(1, merged.imposterCount),
          maxImposterCount(state.players.length),
        );
      }
      return { ...state, settings: merged };
    }

    case 'START_GAME': {
      requirePhase(state, action, 'SETUP');
      if (!playerCountIsValid(state.players.length)) {
        throw new GameRuleError(
          `A game needs 3–12 players, got ${state.players.length}`,
        );
      }
      if (
        state.settings.imposterCount < 1 ||
        state.settings.imposterCount > maxImposterCount(state.players.length)
      ) {
        throw new GameRuleError(
          `${state.settings.imposterCount} imposters is invalid for ${state.players.length} players`,
        );
      }
      const dealt = dealRoles(state, action.seed);
      return {
        ...startClueRound(dealt, action.seed, 1),
        phase: 'REVEAL',
        revealIndex: 0,
        revealShown: false,
      };
    }

    case 'SHOW_ROLE': {
      requirePhase(state, action, 'REVEAL');
      // Idempotent, so the counter can only ever record one view per player.
      if (state.revealShown) return state;
      const player = playerAtReveal(state, state.revealIndex);
      if (!player) throw new GameRuleError('SHOW_ROLE with nobody left to reveal');
      return {
        ...state,
        revealShown: true,
        revealViews: {
          ...state.revealViews,
          [player.id]: (state.revealViews[player.id] ?? 0) + 1,
        },
      };
    }

    case 'HIDE_ROLE': {
      requirePhase(state, action, 'REVEAL');
      if (!state.revealShown) {
        throw new GameRuleError('HIDE_ROLE before the role was shown');
      }
      const next = state.revealIndex + 1;
      // Roles are handed out exactly once, and there is no way back to a
      // previous player's screen.
      if (next >= state.revealOrder.length) {
        return { ...state, phase: 'CLUES', revealShown: false, revealIndex: next };
      }
      return { ...state, revealIndex: next, revealShown: false };
    }

    case 'SUBMIT_CLUE': {
      requirePhase(state, action, 'CLUES');
      if (state.settings.clueMode !== 'TYPE') {
        throw new GameRuleError('SUBMIT_CLUE is only valid in TYPE clue mode');
      }
      const expected = state.turnOrder[state.clueTurnIndex];
      if (action.playerId !== expected) {
        throw new GameRuleError(
          `It is not ${action.playerId}'s turn to give a clue`,
        );
      }
      const text = normalize(action.text.trim());
      if (text.length === 0) {
        throw new GameRuleError('A clue cannot be empty');
      }
      const clueTurnIndex = state.clueTurnIndex + 1;
      const clues = { ...state.clues, [action.playerId]: text };
      return clueTurnIndex >= state.turnOrder.length
        ? { ...state, clues, clueTurnIndex, phase: 'DISCUSSION' }
        : { ...state, clues, clueTurnIndex };
    }

    case 'NEXT_CLUE_TURN': {
      requirePhase(state, action, 'CLUES');
      if (state.settings.clueMode !== 'SPEAK') {
        throw new GameRuleError('NEXT_CLUE_TURN is only valid in SPEAK clue mode');
      }
      const clueTurnIndex = state.clueTurnIndex + 1;
      return clueTurnIndex >= state.turnOrder.length
        ? { ...state, clueTurnIndex, phase: 'DISCUSSION' }
        : { ...state, clueTurnIndex };
    }

    case 'FINISH_CLUES': {
      requirePhase(state, action, 'CLUES');
      return { ...state, phase: 'DISCUSSION' };
    }

    case 'ANOTHER_CLUE_ROUND': {
      requirePhase(state, action, 'DISCUSSION');
      // The group wants to hear everyone again before accusing anyone. Same
      // secret word and same players — only the turn order is redrawn, and any
      // typed clues are cleared so the new round starts blank.
      return startClueRound(state, action.seed, state.roundNumber + 1);
    }

    case 'START_VOTING': {
      requirePhase(state, action, 'DISCUSSION');
      const living = aliveIds(state);
      return {
        ...state,
        phase: 'VOTING',
        voteStage: 'FIRST',
        eligibleTargets: living,
        voterOrder: drawTurnOrder(living, subSeed(action.seed, 'voterOrder')),
        voterIndex: 0,
        votes: [],
        lastVote: null,
      };
    }

    case 'CAST_VOTE': {
      requirePhase(state, action, 'VOTING');
      const voter = currentVoter(state);
      if (voter === null) {
        throw new GameRuleError('Everyone has already voted');
      }
      if (action.voter !== voter) {
        throw new GameRuleError(`It is ${voter}'s turn to vote, not ${action.voter}`);
      }
      if (!voteTargetsFor(state, voter).includes(action.target)) {
        throw new GameRuleError(
          `${action.voter} cannot vote for ${action.target}`,
        );
      }

      // Votes stay hidden in state until the last one lands; the UI never gets
      // a partial tally to leak.
      const votes = [...state.votes, { voter: action.voter, target: action.target }];
      const voterIndex = state.voterIndex + 1;
      if (voterIndex < state.voterOrder.length) {
        return { ...state, votes, voterIndex };
      }

      const result = resolveVote(state, votes);
      const players =
        result.ejectedId === null
          ? state.players
          : state.players.map((p) =>
              p.id === result.ejectedId ? { ...p, alive: false } : p,
            );

      return {
        ...state,
        players,
        votes,
        voterIndex,
        lastVote: result,
        phase: 'VOTE_RESULT',
      };
    }

    case 'CONTINUE': {
      requirePhase(state, action, 'VOTE_RESULT');
      const result = state.lastVote;
      if (!result) throw new GameRuleError('CONTINUE without a vote result');

      if (result.outcome === 'TIE_RUNOFF') {
        // Re-vote, candidates narrowed to the tied leaders.
        return {
          ...state,
          phase: 'VOTING',
          voteStage: 'RUNOFF',
          eligibleTargets: result.tiedIds,
          voterOrder: drawTurnOrder(aliveIds(state), subSeed(action.seed, 'runoffVoters')),
          voterIndex: 0,
          votes: [],
          lastVote: null,
        };
      }

      const winner = checkWinner(state);

      if (winner === 'CITIZENS' && state.settings.imposterGuessEnabled) {
        // The last imposter caught gets one shot at the secret word.
        const guessingImposterId = result.ejectedId;
        if (guessingImposterId && state.secretWordId) {
          return {
            ...state,
            phase: 'IMPOSTER_GUESS',
            guessingImposterId,
            guessOptions: buildGuessOptions(
              state.secretWordId,
              makeRng(subSeed(action.seed, 'guessOptions')),
            ),
            guessResult: null,
            winner: null,
          };
        }
      }

      if (winner !== null) {
        return { ...state, phase: 'GAME_OVER', winner };
      }

      return startClueRound(state, action.seed, state.roundNumber + 1);
    }

    case 'SUBMIT_GUESS': {
      requirePhase(state, action, 'IMPOSTER_GUESS');
      if (!state.guessOptions?.includes(action.wordId)) {
        throw new GameRuleError(`${action.wordId} is not one of the offered options`);
      }
      getWordEntry(action.wordId); // fail loudly on an unknown id
      const correct = action.wordId === state.secretWordId;
      return {
        ...state,
        phase: 'GAME_OVER',
        guessResult: correct ? 'CORRECT' : 'WRONG',
        winner: correct ? 'IMPOSTERS' : 'CITIZENS',
      };
    }

    case 'NEW_ROUND': {
      requirePhase(state, action, 'GAME_OVER');
      const dealt = dealRoles(state, action.seed);
      return {
        ...startClueRound(dealt, action.seed, 1),
        phase: 'REVEAL',
        revealIndex: 0,
        revealShown: false,
      };
    }

    case 'BACK_TO_SETUP': {
      // Always allowed: the host can bail out of any screen.
      return createInitialState(
        state.players.map((p) => p.name),
        state.settings,
      );
    }

    default: {
      const never: never = action;
      throw new Error(`Unknown action: ${JSON.stringify(never)}`);
    }
  }
}

/** Convenience re-export so the UI can suggest an imposter count. */
export { suggestImposterCount, playerById };
