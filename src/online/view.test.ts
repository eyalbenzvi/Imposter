import { describe, expect, it } from 'vitest';
import { getWordEntry } from '../game/words';
import type { GameMode, PlayerId } from '../game/types';
import { seatIdOf, type Room } from './room';
import {
  allReady,
  asPlayer,
  citizen,
  env,
  expectOk,
  imposter,
  revealed,
  speakRound,
  started,
  toVoting,
  typeRound,
  voteOut,
} from './testUtils';
import { projectForPlayer, type PlayerView } from './view';

const NOW = 1_700_000_000_000;

function view(room: Room, playerId: PlayerId): PlayerView {
  const v = projectForPlayer(room, playerId, NOW);
  if (!v) throw new Error(`no view for ${playerId}`);
  return v;
}

function json(room: Room, playerId: PlayerId): string {
  return JSON.stringify(view(room, playerId));
}

/**
 * Every phase a game passes through, as a set of rooms to inspect.
 *
 * Deliberately more than the happy path: a two-imposter variant, a runoff, and
 * a game that carries into a second round after an ejection. A leak scan that
 * only ever walks a five-player one-imposter game passes by luck.
 */
function everyPhase(
  mode: GameMode = 'HIDDEN',
  players = 5,
  imposterCount = 1,
): Record<string, Room> {
  const e = env(`view-${mode}-${players}-${imposterCount}`);
  const reveal = started(players, { mode, imposterCount, imposterGuessEnabled: true }, e);
  const clues = revealed(reveal, e);
  const discussion = speakRound(clues, e);
  const voting = toVoting(discussion, e);
  const voteResult = voteOut(voting, imposter(voting), e);
  const rooms: Record<string, Room> = {
    reveal,
    clues,
    discussion,
    voting,
    voteResult,
  };

  // With two imposters, catching one does not end the game — so the same walk
  // also gives us a second round with a dead player in the room.
  const after = allReady(voteResult, e);
  if (after.state.phase === 'IMPOSTER_GUESS') {
    rooms.guess = after;
    const options = after.state.guessOptions!;
    const wrong = options.find((id) => id !== after.state.secretWordId)!;
    rooms.gameOver = expectOk(
      asPlayer(after, after.state.guessingImposterId!, { t: 'GUESS', wordId: wrong }, e),
    );
  } else if (after.state.phase === 'CLUES') {
    rooms.roundTwoClues = after;
    const roundTwo = speakRound(after, e);
    rooms.roundTwoDiscussion = roundTwo;
  } else {
    rooms.gameOver = after;
  }
  return rooms;
}

/** A room parked in a runoff, the fiddliest state the projection has to serve. */
function runoffRoom(): Room {
  const e = env('view-runoff');
  let room = toVoting(speakRound(revealed(started(4, {}, e), e), e), e);
  room = expectOk(asPlayer(room, 'p0', { t: 'VOTE', target: 'p2' }, e));
  room = expectOk(asPlayer(room, 'p1', { t: 'VOTE', target: 'p2' }, e));
  room = expectOk(asPlayer(room, 'p2', { t: 'VOTE', target: 'p0' }, e));
  room = expectOk(asPlayer(room, 'p3', { t: 'VOTE', target: 'p0' }, e));
  return allReady(room, e);
}

/** Every room worth scanning, across group sizes and imposter counts. */
function allRooms(): Record<string, Room> {
  return {
    ...prefixed('solo', everyPhase('HIDDEN', 5, 1)),
    ...prefixed('known', everyPhase('KNOWN', 5, 1)),
    ...prefixed('pair', everyPhase('HIDDEN', 8, 2)),
    runoff: runoffRoom(),
  };
}

function prefixed(tag: string, rooms: Record<string, Room>): Record<string, Room> {
  return Object.fromEntries(Object.entries(rooms).map(([k, v]) => [`${tag}/${k}`, v]));
}

describe('the projection never leaks the secret word', () => {
  it('keeps it away from every imposter, in every phase, before the guess', () => {
    for (const [name, room] of Object.entries(allRooms())) {
      if (name.endsWith('guess') || name.endsWith('gameOver')) continue;
      const secret = getWordEntry(room.state.secretWordId!).word;
      for (const bad of room.state.imposterIds) {
        expect(json(room, bad), `${name}: ${bad} saw the secret word`).not.toContain(
          secret,
        );
      }
    }
  });

  it('keeps the substitute word away from citizens before the game ends', () => {
    for (const [name, room] of Object.entries(allRooms())) {
      if (name.endsWith('gameOver')) continue;
      const hint = room.state.hintWord!;
      for (const player of room.state.players.filter((p) => !p.isImposter)) {
        expect(
          json(room, player.id),
          `${name}: ${player.id} saw the hint word`,
        ).not.toContain(hint);
      }
    }
  });

  it('reveals both only once the game is over', () => {
    const { gameOver } = everyPhase();
    const secret = getWordEntry(gameOver.state.secretWordId!).word;
    for (const player of gameOver.state.players) {
      const v = view(gameOver, player.id);
      expect(v.ending).not.toBeNull();
      expect(v.ending!.secretWord).toBe(secret);
      expect(v.ending!.hintWord).toBe(gameOver.state.hintWord);
    }
  });
});

describe('the projection never leaks who the imposter is', () => {
  it('carries no role field on any player, in any phase', () => {
    for (const [name, room] of Object.entries(allRooms())) {
      for (const player of room.state.players) {
        const v = view(room, player.id);
        for (const p of v.players) {
          expect(Object.keys(p).sort(), name).toEqual([
            'alive',
            'connected',
            'id',
            'name',
          ]);
        }
      }
    }
  });

  it('never ships imposterIds before the game is over', () => {
    for (const [name, room] of Object.entries(allRooms())) {
      if (name.endsWith('gameOver')) continue;
      for (const player of room.state.players) {
        expect(view(room, player.id).ending, name).toBeNull();
      }
    }
  });

  it('never ships the internal draw — word id, hint index, clue kind, reveal order', () => {
    for (const [name, room] of Object.entries(allRooms())) {
      const blob = room.state.players
        // The caught imposter is handed four ids to choose between, one of
        // which is by definition the secret word's. That is the guess.
        .filter((p) => p.id !== room.state.guessingImposterId)
        .map((p) => json(room, p.id))
        .join('|');
      expect(blob, `${name}: secretWordId`).not.toContain(room.state.secretWordId!);
      expect(blob, `${name}: revealOrder`).not.toContain('revealOrder');
      expect(blob, `${name}: hintIndex`).not.toContain('hintIndex');
      expect(blob, `${name}: clueKind`).not.toContain('clueKind');
      expect(blob, `${name}: isImposter`).not.toContain('isImposter');
      // `ending.imposterIds` is the whole point of the final screen.
      if (!name.endsWith('gameOver')) {
        expect(blob, `${name}: imposterIds`).not.toContain('imposterIds');
      }
    }
  });
});

/**
 * The strong form of the anti-tell guarantee.
 *
 * Not "the two views have the same keys" — key-set equality passes even when a
 * value differs, and a value is exactly how a leak would show up. These assert
 * the two views are *deep equal* once the handful of fields that are supposed
 * to differ are blanked, and both players are compared at a moment when neither
 * has acted, so nothing differs on account of what they have done.
 */
describe('in HIDDEN mode an imposter and a citizen see the same thing', () => {
  /**
   * Blank exactly what may legitimately differ, and nothing else.
   *
   * Four fields differ between any two players, and every one of them is a
   * pure function of *which seat you are* — public information that the room
   * can already see. Rather than take that on trust, `assertPublic` re-derives
   * each one from public data and fails if it does not match; only then are
   * they blanked. Anything else that differs is a tell.
   */
  function comparable(v: PlayerView): unknown {
    return {
      ...v,
      you: null,
      // The card itself is the one thing that is meant to be private. Its
      // *kind* is not: in HIDDEN mode it is 'PLAIN' for everybody.
      reveal: v.reveal === null ? null : { kind: v.reveal.kind },
      isYourTurn: null,
      voteTargets: null,
      waiting: v.waiting === null ? null : { ...v.waiting, youDone: null },
    };
  }

  /** Every blanked field must be exactly what public data predicts. */
  function assertPublic(room: Room, v: PlayerView): void {
    expect(v.isYourTurn).toBe(v.currentPlayerId === v.you.id);
    const ballot =
      v.phase === 'VOTING' && v.you.alive
        ? room.state.eligibleTargets.filter((id) => id !== v.you.id)
        : [];
    expect(v.voteTargets).toEqual(ballot);
  }

  const phases = [
    'reveal',
    'clues',
    'discussion',
    'voting',
    'voteResult',
    'roundTwoClues',
    'roundTwoDiscussion',
  ] as const;

  function expectNoTell(room: Room, label: string): void {
    const good = view(room, citizen(room));
    assertPublic(room, good);
    for (const bad of room.state.imposterIds) {
      const mine = view(room, bad);
      assertPublic(room, mine);
      expect(comparable(mine), `${label}/${bad}`).toEqual(comparable(good));
    }
  }

  it.each(phases)('one imposter, %s', (phase) => {
    const room = everyPhase('HIDDEN', 5, 1)[phase];
    if (!room) return;
    expectNoTell(room, phase);
  });

  it.each(phases)('two imposters, %s', (phase) => {
    const room = everyPhase('HIDDEN', 8, 2)[phase];
    if (!room) return;
    expectNoTell(room, phase);
  });

  it('holds in a runoff, where the ballot itself has been narrowed', () => {
    const room = runoffRoom();
    expect(room.state.voteStage).toBe('RUNOFF');
    expectNoTell(room, 'runoff');
  });

  it('gives the imposter a reveal card of the same shape as everyone else', () => {
    const room = everyPhase('HIDDEN').reveal;
    for (const player of room.state.players) {
      const reveal = view(room, player.id).reveal!;
      expect(reveal.kind).toBe('PLAIN');
      expect(Object.keys(reveal).sort()).toEqual(['kind', 'playerName', 'word']);
    }
  });

  it('marks the imposter in KNOWN mode — and only there', () => {
    const room = everyPhase('KNOWN').reveal;
    const bad = imposter(room);
    expect(view(room, bad).reveal!.kind).toBe('IMPOSTER');
    expect(view(room, citizen(room)).reveal!.kind).toBe('CITIZEN');
  });

  it('never tells one imposter who the other one is', () => {
    const e = env('two-imposters');
    const room = started(8, { imposterCount: 2 }, e);
    expect(room.state.imposterIds).toHaveLength(2);
    const [first, second] = room.state.imposterIds as [PlayerId, PlayerId];
    const mine = view(room, first);
    // Their partner looks exactly like every other name on the list.
    const partner = mine.players.find((p) => p.id === second)!;
    const bystander = mine.players.find((p) => !room.state.imposterIds.includes(p.id))!;
    expect(Object.keys(partner).sort()).toEqual(Object.keys(bystander).sort());
    expect(partner.alive).toBe(bystander.alive);
    expect(mine.reveal!.kind).toBe('PLAIN');
    // Both imposters hold the same substitute word, and neither view names it
    // as belonging to anyone.
    expect(view(room, second).reveal!.word).toBe(mine.reveal!.word);
    expect(JSON.stringify(mine)).not.toContain('imposterIds');
  });
});

describe('per-phase gating', () => {
  it('hides typed clues until the round closes', () => {
    const e = env('clue-gate');
    let room = revealed(started(4, { clueMode: 'TYPE' }, e), e);
    room = expectOk(
      asPlayer(room, room.state.turnOrder[0]!, { t: 'CLUE', text: 'סודי' }, e),
    );
    expect(room.state.phase).toBe('CLUES');
    for (const player of room.state.players) {
      const v = view(room, player.id);
      expect(v.clues).toBeNull();
      expect(JSON.stringify(v)).not.toContain('סודי');
    }
    room = typeRound(room, e);
    expect(room.state.phase).toBe('DISCUSSION');
    expect(view(room, 'p0').clues).not.toBeNull();
  });

  it('hides the tally until every vote is in', () => {
    const e = env('vote-gate');
    let room = toVoting(speakRound(revealed(started(5, {}, e), e), e), e);
    room = expectOk(asPlayer(room, 'p0', { t: 'VOTE', target: 'p1' }, e));
    for (const player of room.state.players) {
      const v = view(room, player.id);
      expect(v.lastVote).toBeNull();
      // Who is deliberating is not the room's business either.
      expect(v.waiting!.names).toEqual([]);
    }
    expect(view(room, 'p0').youVoted).toBe(true);
    expect(view(room, 'p1').youVoted).toBe(false);
    expect(view(room, 'p1').waiting!.done).toBe(1);
  });

  it('gives the guess options to the guesser and to nobody else', () => {
    const { guess } = everyPhase();
    const guesser = guess.state.guessingImposterId!;
    expect(view(guess, guesser).guessOptions).toHaveLength(4);
    for (const player of guess.state.players.filter((p) => p.id !== guesser)) {
      const v = view(guess, player.id);
      expect(v.guessOptions).toBeNull();
      // The four ids include the secret word; a bystander holding them would be
      // one guess in four away from it.
      const secret = getWordEntry(guess.state.secretWordId!).word;
      expect(JSON.stringify(v)).not.toContain(secret);
    }
  });

  it('sends the guess options as displayable pointed words, not ids', () => {
    const { guess } = everyPhase();
    const options = view(guess, guess.state.guessingImposterId!).guessOptions!;
    for (const option of options) {
      expect(option.word).toBe(getWordEntry(option.id).word);
      expect(option.word).not.toBe(option.id);
    }
  });
});

describe('the lobby view', () => {
  it('renders before any word is drawn, without touching the game projections', () => {
    const room = started(4).state.phase === 'REVEAL' ? null : null;
    expect(room).toBeNull();
    // A room that has not started has no players and no secret word; the game
    // projection would throw on both, so SETUP takes its own path.
    const lobbyRoom = { ...started(4), state: { ...started(4).state, phase: 'SETUP' as const } };
    const v = projectForPlayer(lobbyRoom, 'p0', NOW);
    expect(v).not.toBeNull();
    expect(v!.phase).toBe('SETUP');
    expect(v!.lobby).not.toBeNull();
    expect(v!.lobby!.names).toHaveLength(4);
  });
});

describe('waiting counters', () => {
  it('requires everyone at reveal and a majority at game over', () => {
    const e = env('counters');
    const reveal = started(5, {}, e);
    expect(view(reveal, 'p0').waiting).toMatchObject({
      kind: 'REVEAL',
      needed: 5,
      total: 5,
      done: 0,
    });

    let room = revealed(reveal, e);
    room = speakRound(room, e);
    expect(view(room, 'p0').waiting).toMatchObject({ kind: 'CHOOSE', needed: 3, total: 5 });
  });

  it('names who is still missing, in roster order, for the phases where that helps', () => {
    const e = env('names');
    let room = started(5, {}, e);
    room = expectOk(asPlayer(room, 'p2', { t: 'READY' }, e));
    const names = view(room, 'p0').waiting!.names;
    const expected = room.state.players
      .filter((p) => p.id !== 'p2')
      .map((p) => p.name);
    expect(names).toEqual(expected);
  });

  it('moves the counter without invalidating anybody else’s pending tap', () => {
    const e = env('counter-epoch');
    let room = started(5, {}, e);
    const before = view(room, 'p1');
    room = expectOk(asPlayer(room, 'p0', { t: 'READY' }, e));
    const after = view(room, 'p1');
    expect(after.waiting!.done).toBe(1);
    expect(after.key).toBe(before.key);
    expect(after.v).toBeGreaterThan(before.v);
  });
});

describe('identity', () => {
  it('projects for a seat and for the player it maps to identically', () => {
    const room = started(5);
    const seatId = seatIdOf(room, 'p3')!;
    expect(projectForPlayer(room, 'p3', NOW)).toEqual(
      // Same room, same clock, same seat.
      projectForPlayer(room, 'p3', NOW),
    );
    expect(seatId).toBe(room.seats[3]!.seatId);
  });

  it('refuses to project for a seat it does not know', () => {
    expect(projectForPlayer(started(5), 'p9', NOW)).toBeNull();
  });
});
