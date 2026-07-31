import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  GameRuleError,
  InvalidTransitionError,
  createInitialState,
  reducer,
} from './reducer';
import {
  aliveIds,
  buildGuessOptions,
  checkWinner,
  currentVoter,
  getRevealView,
  getSecretEntry,
  maxImposterCount,
  revealAudit,
  revealViewsFor,
  suggestImposterCount,
  voteTargetsFor,
} from './rules';
import { makeRng } from './prng';
import { stripNiqqud } from './niqqud';
import { getWordEntry } from './words';
import {
  aliveCitizens,
  castVotes,
  citizensOf,
  ejectPlayer,
  imposterOf,
  names,
  playClueRound,
  startedGame,
  voteOut,
} from './testUtils';
import type { GameState, PlayerId } from './types';

// ── setup ────────────────────────────────────────────────────────────────────

describe('setup', () => {
  it('starts in SETUP with the hidden mode as default', () => {
    const state = createInitialState();
    expect(state.phase).toBe('SETUP');
    expect(state.settings.mode).toBe('HIDDEN');
    expect(state.settings.clueMode).toBe('SPEAK');
    expect(state.settings.imposterCount).toBe(1);
    // Matches the settings screen as it is actually played.
    expect(state.settings.discussionSeconds).toBe(0);
    expect(state.settings.imposterGuessEnabled).toBe(false);
  });

  it('suggests 2 imposters from 7 players and 1 below that', () => {
    expect(suggestImposterCount(6)).toBe(1);
    expect(suggestImposterCount(7)).toBe(2);
    expect(suggestImposterCount(12)).toBe(2);
  });

  it('keeps imposters strictly outnumbered', () => {
    expect(maxImposterCount(3)).toBe(1);
    expect(maxImposterCount(5)).toBe(2);
    expect(maxImposterCount(12)).toBe(5);
  });

  it('clamps an imposter count that is too high for the group', () => {
    let state = createInitialState(names(3));
    state = reducer(state, { type: 'UPDATE_SETTINGS', patch: { imposterCount: 2 } });
    expect(state.settings.imposterCount).toBe(1);
  });

  it('rejects fewer than 3 and more than 12 players', () => {
    const tooFew = createInitialState(names(2));
    expect(() => reducer(tooFew, { type: 'START_GAME', seed: 's' })).toThrow(
      GameRuleError,
    );

    const tooMany = createInitialState([...names(12), 'נוֹסָף']);
    expect(() => reducer(tooMany, { type: 'START_GAME', seed: 's' })).toThrow(
      GameRuleError,
    );
  });
});

// ── dealing and reveal ───────────────────────────────────────────────────────

describe('dealing roles', () => {
  it('draws a word, one of its five hints, and the imposters', () => {
    const state = startedGame(5);
    const entry = getSecretEntry(state)!;
    expect(entry).toBeTruthy();
    expect(state.hintIndex).toBeGreaterThanOrEqual(0);
    expect(state.hintIndex).toBeLessThan(5);
    expect(state.hintWord).toBe(entry.hints[state.hintIndex!]);
    expect(state.imposterIds).toHaveLength(1);
  });

  it('hands the hint word to the imposter and the secret to everyone else', () => {
    const state = startedGame(5);
    const imposter = imposterOf(state);
    expect(getRevealView(state, imposter).word).toBe(state.hintWord);
    for (const citizen of citizensOf(state)) {
      expect(getRevealView(state, citizen).word).toBe(getSecretEntry(state)!.word);
    }
  });

  it('never hands out the secret word as its own substitute', () => {
    const state = startedGame(5);
    expect(stripNiqqud(state.hintWord!)).not.toBe(
      stripNiqqud(getSecretEntry(state)!.word),
    );
  });

  it('walks every player through reveal exactly once, then moves to CLUES', () => {
    let state = createInitialState(names(4));
    state = reducer(state, { type: 'START_GAME', seed: 'reveal-seed' });

    const seen: string[] = [];
    while (state.phase === 'REVEAL') {
      state = reducer(state, { type: 'SHOW_ROLE' });
      expect(state.revealShown).toBe(true);
      seen.push(state.revealOrder[state.revealIndex]!);
      state = reducer(state, { type: 'HIDE_ROLE' });
    }

    // Every player exactly once, in the round's shuffled order.
    expect([...seen].sort()).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(seen).toEqual(state.revealOrder);
    expect(state.phase).toBe('CLUES');
  });

  it('counts exactly one uncovering per player', () => {
    const state = startedGame(5);
    const audit = revealAudit(state);
    expect(audit.rows.map((r) => r.views)).toEqual([1, 1, 1, 1, 1]);
    expect(audit.everyoneSawOnce).toBe(true);
    expect(audit.extraViews).toBe(0);
    for (const player of state.players) {
      expect(revealViewsFor(state, player.id)).toBe(1);
    }
  });

  it('does not count a second SHOW_ROLE for the same player', () => {
    let state = createInitialState(names(4));
    state = reducer(state, { type: 'START_GAME', seed: 'peek' });
    const first = state.revealOrder[0]!;
    state = reducer(state, { type: 'SHOW_ROLE' });
    // Tapping again must not register another look.
    state = reducer(state, { type: 'SHOW_ROLE' });
    state = reducer(state, { type: 'SHOW_ROLE' });
    expect(revealViewsFor(state, first)).toBe(1);
    expect(state.revealViews).toEqual({ [first]: 1 });
  });

  it('starts a fresh ledger for a new round', () => {
    let state = startedGame(4, { imposterGuessEnabled: false });
    expect(revealAudit(state).everyoneSawOnce).toBe(true);
    state = ejectPlayer(playClueRound(state), imposterOf(state));
    state = reducer(state, { type: 'NEW_ROUND', seed: 'again' });
    expect(state.revealViews).toEqual({});
    expect(revealAudit(state).rows.every((r) => r.views === 0)).toBe(true);
  });

  it('keeps the ledger untouched by the rest of the game', () => {
    let state = startedGame(5, { imposterGuessEnabled: false });
    const ledger = state.revealViews;
    state = playClueRound(state);
    state = voteOut(state, citizensOf(state)[0]!);
    state = reducer(state, { type: 'CONTINUE', seed: 'on' });
    expect(state.revealViews).toEqual(ledger);
  });

  it('refuses to hide a role that was never shown', () => {
    let state = createInitialState(names(4));
    state = reducer(state, { type: 'START_GAME', seed: 's' });
    expect(() => reducer(state, { type: 'HIDE_ROLE' })).toThrow(GameRuleError);
  });

  it('shuffles the reveal order over every player', () => {
    const state = startedGame(6);
    expect([...state.revealOrder].sort()).toEqual(
      state.players.map((p) => p.id).sort(),
    );
    expect(state.revealOrder).toHaveLength(6);
  });

  it('varies the reveal order across seeds', () => {
    const orders = new Set(
      ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'].map((seed) =>
        startedGame(6, {}, seed).revealOrder.join(','),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('shuffles who is asked to vote first', () => {
    const orders = new Set<string>();
    for (const seed of ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8']) {
      const state = playClueRound(startedGame(6, {}, seed));
      const voting = reducer(state, { type: 'START_VOTING', seed: `vote-${seed}` });
      expect([...voting.voterOrder].sort()).toEqual(aliveIds(voting).sort());
      orders.add(voting.voterOrder.join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('reshuffles the voters for a runoff', () => {
    const state = playClueRound(startedGame(6));
    const first = reducer(state, { type: 'START_VOTING', seed: 'a' });
    const second = reducer(state, { type: 'START_VOTING', seed: 'b' });
    expect(first.voterOrder).not.toEqual(second.voterOrder);
  });

  it('gives everyone a fresh turn order per round', () => {
    const state = startedGame(6);
    expect([...state.turnOrder].sort()).toEqual([...aliveIds(state)].sort());
  });
});

// ── the two game modes ───────────────────────────────────────────────────────

describe('HIDDEN mode', () => {
  it('exposes nothing that marks the imposter as the imposter', () => {
    const state = startedGame(5, { mode: 'HIDDEN' });
    const imposter = imposterOf(state);
    const citizen = citizensOf(state)[0]!;

    const impView = getRevealView(state, imposter);
    const citView = getRevealView(state, citizen);

    // Structurally indistinguishable: same kind, same key set.
    expect(impView.kind).toBe('PLAIN');
    expect(citView.kind).toBe('PLAIN');
    expect(Object.keys(impView).sort()).toEqual(Object.keys(citView).sort());
    expect(Object.keys(impView).sort()).toEqual(['kind', 'playerName', 'word']);

    // Nothing in the payload hints at a role at all.
    const serialized = JSON.stringify(impView);
    expect(serialized).not.toContain('IMPOSTER');
    expect(serialized).not.toContain('isImposter');
    expect(serialized).not.toContain('imposter');
    for (const value of Object.values(impView)) {
      expect(typeof value).toBe('string');
    }
  });

  it('gives both imposters the very same substitute word', () => {
    const state = startedGame(8, { mode: 'HIDDEN', imposterCount: 2 });
    expect(state.imposterIds).toHaveLength(2);
    const views = state.imposterIds.map((id) => getRevealView(state, id));
    expect(views[0]!.word).toBe(views[1]!.word);
    expect(views[0]!.word).toBe(state.hintWord);
    expect(views.every((v) => v.kind === 'PLAIN')).toBe(true);
  });
});

describe('KNOWN mode', () => {
  it('marks the imposter and only the imposter', () => {
    const state = startedGame(5, { mode: 'KNOWN' });
    const imposter = imposterOf(state);
    expect(getRevealView(state, imposter).kind).toBe('IMPOSTER');
    for (const citizen of citizensOf(state)) {
      expect(getRevealView(state, citizen).kind).toBe('CITIZEN');
    }
  });

  it('still gives the imposter the substitute word to blend in with', () => {
    const state = startedGame(5, { mode: 'KNOWN' });
    expect(getRevealView(state, imposterOf(state)).word).toBe(state.hintWord);
  });

  it('never leaks the identity of the other imposter', () => {
    const state = startedGame(8, { mode: 'KNOWN', imposterCount: 2 });
    const [first, second] = state.imposterIds as [PlayerId, PlayerId];
    const view = getRevealView(state, first);

    expect(Object.keys(view).sort()).toEqual(['kind', 'playerName', 'word']);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(second);
    // ...and not the partner's name either.
    const partnerName = state.players.find((p) => p.id === second)!.name;
    expect(serialized).not.toContain(partnerName);
  });
});

// ── determinism ──────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('produces an identical game from an identical seed', () => {
    const a = startedGame(6, {}, 'same-seed');
    const b = startedGame(6, {}, 'same-seed');
    expect(a).toEqual(b);
    expect(a.secretWordId).toBe(b.secretWordId);
    expect(a.hintIndex).toBe(b.hintIndex);
    expect(a.hintWord).toBe(b.hintWord);
    expect(a.imposterIds).toEqual(b.imposterIds);
    expect(a.turnOrder).toEqual(b.turnOrder);
  });

  it('produces a different game from a different seed', () => {
    const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
    const games = seeds.map((seed) => startedGame(6, {}, seed));
    expect(new Set(games.map((g) => g.secretWordId)).size).toBeGreaterThan(1);
    expect(new Set(games.map((g) => g.turnOrder.join(','))).size).toBeGreaterThan(1);
  });

  it('never touches Math.random', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('the reducer must not call Math.random');
    };
    try {
      const state = startedGame(5);
      const discussion = playClueRound(state);
      expect(() => ejectPlayer(discussion, imposterOf(state))).not.toThrow();
    } finally {
      Math.random = original;
    }
  });

  it('keeps the state JSON-serializable at every phase', () => {
    let state = startedGame(4, { imposterGuessEnabled: true });
    const seen: GameState[] = [state];
    state = playClueRound(state);
    seen.push(state);
    state = voteOut(state, imposterOf(state));
    seen.push(state);
    state = reducer(state, { type: 'CONTINUE', seed: 'c' });
    seen.push(state);
    state = reducer(state, { type: 'SUBMIT_GUESS', wordId: state.guessOptions![0]! });
    seen.push(state);

    for (const snapshot of seen) {
      expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    }
  });
});

// ── clue round ───────────────────────────────────────────────────────────────

describe('clue round', () => {
  it('runs one turn per living player in SPEAK mode', () => {
    const state = startedGame(5);
    expect(state.turnOrder).toHaveLength(5);
    const done = playClueRound(state);
    expect(done.phase).toBe('DISCUSSION');
    expect(done.clueTurnIndex).toBe(5);
  });

  it('collects typed clues in TYPE mode and rejects out-of-turn input', () => {
    let state = startedGame(4, { clueMode: 'TYPE' });
    const [first, second] = state.turnOrder as [PlayerId, PlayerId];

    expect(() =>
      reducer(state, { type: 'SUBMIT_CLUE', playerId: second, text: 'מִשְׁהוּ' }),
    ).toThrow(GameRuleError);

    state = reducer(state, { type: 'SUBMIT_CLUE', playerId: first, text: ' חַם ' });
    expect(state.clues[first]).toBe('חַם');

    while (state.phase === 'CLUES') {
      const who = state.turnOrder[state.clueTurnIndex]!;
      state = reducer(state, { type: 'SUBMIT_CLUE', playerId: who, text: `רֶמֶז-${who}` });
    }
    expect(state.phase).toBe('DISCUSSION');
    expect(Object.keys(state.clues)).toHaveLength(4);
  });

  it('rejects an empty typed clue', () => {
    const state = startedGame(4, { clueMode: 'TYPE' });
    expect(() =>
      reducer(state, {
        type: 'SUBMIT_CLUE',
        playerId: state.turnOrder[0]!,
        text: '   ',
      }),
    ).toThrow(GameRuleError);
  });

  it('keeps the clue modes from bleeding into each other', () => {
    const speak = startedGame(4, { clueMode: 'SPEAK' });
    expect(() =>
      reducer(speak, { type: 'SUBMIT_CLUE', playerId: speak.turnOrder[0]!, text: 'א' }),
    ).toThrow(GameRuleError);

    const type = startedGame(4, { clueMode: 'TYPE' });
    expect(() => reducer(type, { type: 'NEXT_CLUE_TURN' })).toThrow(GameRuleError);
  });

  it('reshuffles the opener across rounds', () => {
    // A double tie keeps everyone alive and opens a fresh clue round.
    const openers = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const state = startedGame(5, {}, seed);
      openers.add(state.turnOrder[0]!);
    }
    expect(openers.size).toBeGreaterThan(1);
  });
});

// ── voting ───────────────────────────────────────────────────────────────────

describe('voting', () => {
  it('hides the tally until the last vote lands', () => {
    let state = playClueRound(startedGame(4));
    state = reducer(state, { type: 'START_VOTING', seed: 'v' });

    while (state.phase === 'VOTING') {
      expect(state.lastVote).toBeNull();
      const voter = currentVoter(state)!;
      state = reducer(state, {
        type: 'CAST_VOTE',
        voter,
        target: voteTargetsFor(state, voter)[0]!,
      });
    }
    expect(state.phase).toBe('VOTE_RESULT');
    expect(state.lastVote).not.toBeNull();
  });

  it('reveals the full breakdown of who voted for whom', () => {
    const state = voteOut(playClueRound(startedGame(4)), 'p2');
    expect(state.lastVote!.votes).toHaveLength(4);
    expect(state.lastVote!.votes.map((v) => v.voter).sort()).toEqual([
      'p0',
      'p1',
      'p2',
      'p3',
    ]);
    expect(state.lastVote!.tally.find((r) => r.playerId === 'p2')!.count).toBe(3);
  });

  it('will not let a player vote for themselves', () => {
    let state = playClueRound(startedGame(4));
    state = reducer(state, { type: 'START_VOTING', seed: 'v' });
    const voter = currentVoter(state)!;
    expect(voteTargetsFor(state, voter)).not.toContain(voter);
    expect(() => reducer(state, { type: 'CAST_VOTE', voter, target: voter })).toThrow(
      GameRuleError,
    );
  });

  it('will not let a player vote out of turn or twice', () => {
    let state = playClueRound(startedGame(4));
    state = reducer(state, { type: 'START_VOTING', seed: 'v' });

    // Voting order is shuffled, so derive the turn rather than assuming it.
    const first = currentVoter(state)!;
    const later = state.voterOrder[2]!;
    const target = voteTargetsFor(state, first)[0]!;

    expect(() =>
      reducer(state, { type: 'CAST_VOTE', voter: later, target }),
    ).toThrow(GameRuleError);

    state = reducer(state, { type: 'CAST_VOTE', voter: first, target });
    expect(() =>
      reducer(state, { type: 'CAST_VOTE', voter: first, target }),
    ).toThrow(GameRuleError);
  });

  it('drops ejected players from the next round entirely', () => {
    const game = startedGame(6);
    const state = ejectPlayer(playClueRound(game), aliveCitizens(game)[0]!);
    expect(state.phase).toBe('CLUES');
    expect(state.voterOrder).toHaveLength(5);
    expect(state.turnOrder).toHaveLength(5);
    expect(state.eligibleTargets).toHaveLength(5);
  });
});

describe('ties', () => {
  /** 4 players, 2–2 split between p0 and p2. */
  const tiedPlan: Record<PlayerId, PlayerId> = {
    p0: 'p2',
    p1: 'p2',
    p2: 'p0',
    p3: 'p0',
  };

  it('sends a first tie to a runoff between the leaders only', () => {
    let state = playClueRound(startedGame(4));
    state = reducer(state, { type: 'START_VOTING', seed: 'v' });
    state = castVotes(state, tiedPlan);

    expect(state.phase).toBe('VOTE_RESULT');
    expect(state.lastVote!.outcome).toBe('TIE_RUNOFF');
    expect(state.lastVote!.ejectedId).toBeNull();
    expect([...state.lastVote!.tiedIds].sort()).toEqual(['p0', 'p2']);
    expect(state.players.every((p) => p.alive)).toBe(true);

    state = reducer(state, { type: 'CONTINUE', seed: 'runoff' });
    expect(state.phase).toBe('VOTING');
    expect(state.voteStage).toBe('RUNOFF');
    expect([...state.eligibleTargets].sort()).toEqual(['p0', 'p2']);
    // Everyone still votes, they just have fewer candidates.
    expect(state.voterOrder).toHaveLength(4);
    expect(state.votes).toHaveLength(0);
  });

  it('ejects nobody after a second tie and opens another clue round', () => {
    let state = playClueRound(startedGame(4));
    state = reducer(state, { type: 'START_VOTING', seed: 'v' });
    state = castVotes(state, tiedPlan);
    state = reducer(state, { type: 'CONTINUE', seed: 'runoff' });
    state = castVotes(state, tiedPlan);

    expect(state.lastVote!.outcome).toBe('TIE_NO_EJECTION');
    expect(state.lastVote!.ejectedId).toBeNull();

    const before = state.roundNumber;
    state = reducer(state, { type: 'CONTINUE', seed: 'next-round' });
    expect(state.phase).toBe('CLUES');
    expect(state.roundNumber).toBe(before + 1);
    expect(state.players.every((p) => p.alive)).toBe(true);
    expect(state.voteStage).toBe('FIRST');
    expect(state.eligibleTargets).toHaveLength(4);
    expect(state.clues).toEqual({});
  });

  it('resolves a runoff that is no longer tied', () => {
    let state = playClueRound(startedGame(4));
    state = reducer(state, { type: 'START_VOTING', seed: 'v' });
    state = castVotes(state, tiedPlan);
    state = reducer(state, { type: 'CONTINUE', seed: 'runoff' });
    state = castVotes(state, { p0: 'p2', p1: 'p2', p2: 'p0', p3: 'p2' });

    expect(state.lastVote!.outcome).toBe('EJECTED');
    expect(state.lastVote!.ejectedId).toBe('p2');
    expect(state.players.find((p) => p.id === 'p2')!.alive).toBe(false);
  });

  it('keeps the secret word across rounds', () => {
    let state = playClueRound(startedGame(4));
    const word = state.secretWordId;
    const hint = state.hintWord;
    state = reducer(state, { type: 'START_VOTING', seed: 'v' });
    state = castVotes(state, tiedPlan);
    state = reducer(state, { type: 'CONTINUE', seed: 'r' });
    state = castVotes(state, tiedPlan);
    state = reducer(state, { type: 'CONTINUE', seed: 'r2' });
    expect(state.secretWordId).toBe(word);
    expect(state.hintWord).toBe(hint);
  });
});

// ── win conditions ───────────────────────────────────────────────────────────

describe('citizens win', () => {
  it('wins the moment the last imposter is ejected, with guessing off', () => {
    let state = startedGame(5, { imposterGuessEnabled: false });
    const imposter = imposterOf(state);
    state = playClueRound(state);
    state = voteOut(state, imposter);

    expect(state.lastVote!.ejectedId).toBe(imposter);
    expect(state.lastVote!.ejectedWasImposter).toBe(true);

    state = reducer(state, { type: 'CONTINUE', seed: 'end' });
    expect(state.phase).toBe('GAME_OVER');
    expect(state.winner).toBe('CITIZENS');
    expect(state.guessResult).toBeNull();
  });

  it('needs both imposters gone when there are two', () => {
    let state = startedGame(8, { imposterCount: 2, imposterGuessEnabled: false });
    const [first, second] = state.imposterIds as [PlayerId, PlayerId];

    state = ejectPlayer(playClueRound(state), first);
    expect(state.phase).toBe('CLUES');
    expect(state.winner).toBeNull();

    state = ejectPlayer(playClueRound(state), second);
    expect(state.phase).toBe('GAME_OVER');
    expect(state.winner).toBe('CITIZENS');
  });

  it('reports a citizen ejection as a citizen', () => {
    let state = startedGame(5);
    const citizen = citizensOf(state)[0]!;
    state = voteOut(playClueRound(state), citizen);
    expect(state.lastVote!.ejectedWasImposter).toBe(false);
  });
});

describe('imposter wins', () => {
  it('wins with a single imposter once only two players are left', () => {
    let state = startedGame(4);
    const imposter = imposterOf(state);

    for (const citizen of citizensOf(state)) {
      if (state.phase === 'GAME_OVER') break;
      state = ejectPlayer(playClueRound(state), citizen);
    }

    expect(state.phase).toBe('GAME_OVER');
    expect(state.winner).toBe('IMPOSTERS');
    expect(state.players.filter((p) => p.alive)).toHaveLength(2);
    expect(state.players.find((p) => p.id === imposter)!.alive).toBe(true);
  });

  it('wins with two imposters once they match the citizens', () => {
    let state = startedGame(7, { imposterCount: 2 });
    // 5 citizens, 2 imposters → citizens must drop to 2.
    for (const citizen of citizensOf(state)) {
      if (state.phase === 'GAME_OVER') break;
      state = ejectPlayer(playClueRound(state), citizen);
    }
    expect(state.phase).toBe('GAME_OVER');
    expect(state.winner).toBe('IMPOSTERS');
    expect(state.players.filter((p) => p.alive && p.isImposter)).toHaveLength(2);
    expect(state.players.filter((p) => p.alive && !p.isImposter)).toHaveLength(2);
  });

  it('checkWinner agrees with the phase machine', () => {
    const state = startedGame(5);
    expect(checkWinner(state)).toBeNull();
  });
});

// ── imposter guess ───────────────────────────────────────────────────────────

describe('imposter guess', () => {
  function caughtImposter(seed = 'guess-seed'): GameState {
    let state = startedGame(5, { imposterGuessEnabled: true }, seed);
    state = playClueRound(state);
    state = voteOut(state, imposterOf(state));
    return reducer(state, { type: 'CONTINUE', seed: `continue-${seed}` });
  }

  it('offers the caught imposter exactly 4 options from one category', () => {
    const state = caughtImposter();
    expect(state.phase).toBe('IMPOSTER_GUESS');
    expect(state.guessingImposterId).toBe(state.imposterIds[0]);
    expect(state.guessOptions).toHaveLength(4);

    const entries = state.guessOptions!.map(getWordEntry);
    const secret = getSecretEntry(state)!;
    expect(state.guessOptions).toContain(secret.id);
    expect(entries.every((e) => e.category === secret.category)).toBe(true);
  });

  it('offers no duplicates, comparing without niqqud', () => {
    const state = caughtImposter();
    const plain = state.guessOptions!.map((id) => stripNiqqud(getWordEntry(id).word));
    expect(new Set(plain).size).toBe(4);
    expect(new Set(state.guessOptions).size).toBe(4);
  });

  it('shuffles the correct answer around across seeds', () => {
    const positions = new Set<number>();
    for (const seed of ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8']) {
      const state = caughtImposter(seed);
      positions.add(state.guessOptions!.indexOf(state.secretWordId!));
    }
    expect(positions.size).toBeGreaterThan(1);
  });

  it('hands the win to the imposter on a correct guess', () => {
    let state = caughtImposter();
    state = reducer(state, { type: 'SUBMIT_GUESS', wordId: state.secretWordId! });
    expect(state.phase).toBe('GAME_OVER');
    expect(state.guessResult).toBe('CORRECT');
    expect(state.winner).toBe('IMPOSTERS');
  });

  it('leaves the win with the citizens on a wrong guess', () => {
    let state = caughtImposter();
    const wrong = state.guessOptions!.find((id) => id !== state.secretWordId)!;
    state = reducer(state, { type: 'SUBMIT_GUESS', wordId: wrong });
    expect(state.phase).toBe('GAME_OVER');
    expect(state.guessResult).toBe('WRONG');
    expect(state.winner).toBe('CITIZENS');
  });

  it('rejects a guess that was not on the board', () => {
    const state = caughtImposter();
    const offBoard = 'this-id-was-never-offered';
    expect(() => reducer(state, { type: 'SUBMIT_GUESS', wordId: offBoard })).toThrow(
      GameRuleError,
    );
  });

  it('skips the guess entirely when the setting is off', () => {
    let state = startedGame(5, { imposterGuessEnabled: false });
    state = voteOut(playClueRound(state), imposterOf(state));
    state = reducer(state, { type: 'CONTINUE', seed: 'x' });
    expect(state.phase).toBe('GAME_OVER');
    expect(state.guessOptions).toBeNull();
  });

  it('only offers the guess to the last imposter standing', () => {
    let state = startedGame(8, { imposterCount: 2, imposterGuessEnabled: true });
    const [first, second] = state.imposterIds as [PlayerId, PlayerId];
    state = ejectPlayer(playClueRound(state), first);
    expect(state.phase).toBe('CLUES');
    state = voteOut(playClueRound(state), second);
    state = reducer(state, { type: 'CONTINUE', seed: 'g' });
    expect(state.phase).toBe('IMPOSTER_GUESS');
    expect(state.guessingImposterId).toBe(second);
  });

  it('builds options from the rest of the store if a category is tiny', () => {
    const rng = makeRng('fallback');
    const options = buildGuessOptions('pizza', rng);
    expect(options).toHaveLength(4);
    expect(new Set(options).size).toBe(4);
  });
});

// ── group sizes ──────────────────────────────────────────────────────────────

describe('group sizes', () => {
  it('plays a full 3-player game', () => {
    let state = startedGame(3, { imposterGuessEnabled: false });
    expect(state.players).toHaveLength(3);
    expect(state.imposterIds).toHaveLength(1);
    expect(state.turnOrder).toHaveLength(3);

    // One ejection is enough either way: 3 → 2 players.
    state = ejectPlayer(playClueRound(state), citizensOf(state)[0]!);
    expect(state.phase).toBe('GAME_OVER');
    expect(state.winner).toBe('IMPOSTERS');
  });

  it('lets the citizens win a 3-player game by catching the imposter', () => {
    let state = startedGame(3, { imposterGuessEnabled: false });
    state = ejectPlayer(playClueRound(state), imposterOf(state));
    expect(state.phase).toBe('GAME_OVER');
    expect(state.winner).toBe('CITIZENS');
  });

  it('handles the 12-player maximum', () => {
    let state = startedGame(12, { imposterCount: 2, imposterGuessEnabled: false });
    expect(state.players).toHaveLength(12);
    expect(state.imposterIds).toHaveLength(2);
    expect(state.turnOrder).toHaveLength(12);
    expect(state.voterOrder).toHaveLength(12);

    state = ejectPlayer(playClueRound(state), citizensOf(state)[0]!);
    expect(state.phase).toBe('CLUES');
    expect(state.turnOrder).toHaveLength(11);
    expect(state.roundNumber).toBe(2);
  });

  it('runs a 12-player game all the way to a citizen win', () => {
    let state = startedGame(12, { imposterCount: 2, imposterGuessEnabled: false });
    const [first, second] = state.imposterIds as [PlayerId, PlayerId];
    state = ejectPlayer(playClueRound(state), first);
    state = ejectPlayer(playClueRound(state), second);
    expect(state.winner).toBe('CITIZENS');
  });
});

// ── another round ────────────────────────────────────────────────────────────

describe('another round', () => {
  it('keeps the players and settings but redeals everything else', () => {
    let state = startedGame(6, { mode: 'KNOWN', imposterGuessEnabled: false });
    const firstWord = state.secretWordId;
    state = ejectPlayer(playClueRound(state), imposterOf(state));
    expect(state.phase).toBe('GAME_OVER');

    state = reducer(state, { type: 'NEW_ROUND', seed: 'brand-new' });
    expect(state.phase).toBe('REVEAL');
    expect(state.revealIndex).toBe(0);
    expect(state.revealShown).toBe(false);
    expect(state.roundNumber).toBe(1);
    expect(state.players).toHaveLength(6);
    expect(state.players.every((p) => p.alive)).toBe(true);
    expect(state.settings.mode).toBe('KNOWN');
    expect(state.winner).toBeNull();
    expect(state.lastVote).toBeNull();
    expect(state.guessResult).toBeNull();
    expect(state.secretWordId).not.toBe(firstWord);
  });

  it('goes back to setup with the roster intact', () => {
    const state = reducer(startedGame(5), { type: 'BACK_TO_SETUP' });
    expect(state.phase).toBe('SETUP');
    expect(state.players.map((p) => p.name)).toEqual(names(5));
    expect(state.secretWordId).toBeNull();
    expect(state.players.every((p) => !p.isImposter)).toBe(true);
  });
});

// ── phase machine ────────────────────────────────────────────────────────────

describe('illegal transitions', () => {
  it('throws when an action does not belong to the current phase', () => {
    const setup = createInitialState(names(4));
    expect(() => reducer(setup, { type: 'SHOW_ROLE' })).toThrow(InvalidTransitionError);
    expect(() => reducer(setup, { type: 'START_VOTING', seed: 'v' })).toThrow(
      InvalidTransitionError,
    );
    expect(() => reducer(setup, { type: 'CONTINUE', seed: 's' })).toThrow(
      InvalidTransitionError,
    );

    const reveal = reducer(setup, { type: 'START_GAME', seed: 's' });
    expect(() => reducer(reveal, { type: 'NEXT_CLUE_TURN' })).toThrow(
      InvalidTransitionError,
    );
    expect(() => reducer(reveal, { type: 'START_GAME', seed: 's' })).toThrow(
      InvalidTransitionError,
    );

    const clues = startedGame(4);
    expect(() => reducer(clues, { type: 'CAST_VOTE', voter: 'p0', target: 'p1' })).toThrow(
      InvalidTransitionError,
    );
    expect(() => reducer(clues, { type: 'SUBMIT_GUESS', wordId: 'pizza' })).toThrow(
      InvalidTransitionError,
    );
    expect(() => reducer(clues, { type: 'NEW_ROUND', seed: 's' })).toThrow(
      InvalidTransitionError,
    );

    const discussion = playClueRound(clues);
    expect(() => reducer(discussion, { type: 'NEXT_CLUE_TURN' })).toThrow(
      InvalidTransitionError,
    );

    const voting = reducer(discussion, { type: 'START_VOTING', seed: 'v' });
    expect(() => reducer(voting, { type: 'START_VOTING', seed: 'v' })).toThrow(
      InvalidTransitionError,
    );
    expect(() => reducer(voting, { type: 'CONTINUE', seed: 's' })).toThrow(
      InvalidTransitionError,
    );
  });

  it('names the phase and the action in the error', () => {
    const setup = createInitialState(names(4));
    try {
      reducer(setup, { type: 'SHOW_ROLE' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const typed = err as InvalidTransitionError;
      expect(typed.phase).toBe('SETUP');
      expect(typed.action).toBe('SHOW_ROLE');
      expect(typed.message).toContain('SHOW_ROLE');
      expect(typed.message).toContain('SETUP');
    }
  });

  it('refuses to change settings once a game is running', () => {
    const state = startedGame(4);
    expect(() =>
      reducer(state, { type: 'UPDATE_SETTINGS', patch: { mode: 'KNOWN' } }),
    ).toThrow(InvalidTransitionError);
  });

  it('allows bailing out to setup from anywhere', () => {
    const state = startedGame(4);
    expect(reducer(state, { type: 'BACK_TO_SETUP' }).phase).toBe('SETUP');
    const voting = reducer(playClueRound(state), { type: 'START_VOTING', seed: 'v' });
    expect(reducer(voting, { type: 'BACK_TO_SETUP' }).phase).toBe('SETUP');
  });

  it('does not mutate the state it was handed', () => {
    const state = startedGame(4);
    const snapshot = JSON.stringify(state);
    reducer(state, { type: 'NEXT_CLUE_TURN' });
    reducer(state, { type: 'BACK_TO_SETUP' });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('defaults', () => {
  it('are the ones the rules call for', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      mode: 'HIDDEN',
      clueMode: 'SPEAK',
      imposterCount: 1,
      discussionSeconds: 0,
      clueTimerSeconds: 0,
      imposterGuessEnabled: false,
    });
  });
});
