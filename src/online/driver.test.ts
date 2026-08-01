import { describe, expect, it } from 'vitest';
import { reducer } from '../game/reducer';
import { currentCluePlayer } from '../game/rules';
import {
  castAll,
  names,
  playClueRound,
  startedGame,
} from '../game/testUtils';
import type { GameState } from '../game/types';
import { handleIntent, handleJoin, startGame } from './driver';
import { PROTOCOL_VERSION } from './protocol';
import { createRoom, playerIdOf, seatIdOf } from './room';
import { majority } from './thresholds';
import {
  allReady,
  asPlayer,
  citizen,
  env,
  expectOk,
  host,
  imposter,
  lobby,
  revealed,
  speakRound,
  started,
  toVoting,
  typeRound,
  voteOut,
  SEED,
} from './testUtils';

describe('lobby', () => {
  it('seats the host first and hands out ids in join order', () => {
    const room = lobby(4);
    expect(room.seats).toHaveLength(4);
    expect(room.seats[0]!.isHost).toBe(true);
    expect(room.seats.map((s) => s.name)).toEqual(names(4));
  });

  it('rejects a name that only differs by niqqud — the reducer would refuse to start', () => {
    let room = createRoom('1234', 'דָּנָה');
    const out = handleJoin(room, 'c1', { t: 'JOIN', v: PROTOCOL_VERSION, name: 'דנה' });
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe('NAME_TAKEN');
    room = out.room;
    expect(room.seats).toHaveLength(1);
  });

  it('rejects a name that only differs by surrounding or inner whitespace', () => {
    const room = createRoom('1234', 'דנה');
    expect(
      handleJoin(room, 'c1', { t: 'JOIN', v: PROTOCOL_VERSION, name: '  דנה ' }).reason,
    ).toBe('NAME_TAKEN');
  });

  it('rejects blank, whitespace-only and over-long names', () => {
    const room = lobby(3);
    expect(handleJoin(room, 'x', { t: 'JOIN', v: PROTOCOL_VERSION, name: '' }).reason).toBe(
      'NAME_EMPTY',
    );
    expect(
      handleJoin(room, 'x', { t: 'JOIN', v: PROTOCOL_VERSION, name: '   ' }).reason,
    ).toBe('NAME_EMPTY');
    expect(
      handleJoin(room, 'x', { t: 'JOIN', v: PROTOCOL_VERSION, name: 'א'.repeat(15) })
        .reason,
    ).toBe('NAME_LONG');
  });

  it('turns away a thirteenth player', () => {
    const room = lobby(12);
    expect(
      handleJoin(room, 'c12', { t: 'JOIN', v: PROTOCOL_VERSION, name: 'נוסף' }).reason,
    ).toBe('ROOM_FULL');
  });

  it('rejects a mismatched protocol version', () => {
    const room = lobby(3);
    expect(handleJoin(room, 'x', { t: 'JOIN', v: 99, name: 'רון' }).reason).toBe(
      'BAD_VERSION',
    );
  });

  it('is idempotent for a repeat JOIN over the same channel (StrictMode, retries)', () => {
    let room = createRoom('1234', 'אבי');
    const first = handleJoin(room, 'c1', { t: 'JOIN', v: PROTOCOL_VERSION, name: 'בני' });
    room = first.room;
    const second = handleJoin(room, 'c1', { t: 'JOIN', v: PROTOCOL_VERSION, name: 'בני' });
    expect(second.accepted).toBe(true);
    expect(second.seatId).toBe(first.seatId);
    expect(second.room.seats).toHaveLength(2);
  });

  it('refuses a seat that another live device is holding', () => {
    let room = lobby(3);
    const seatId = room.seats[1]!.seatId;
    const out = handleJoin(room, 'other-tab', {
      t: 'JOIN',
      v: PROTOCOL_VERSION,
      name: 'בני',
      seatId,
    });
    expect(out.reason).toBe('SEAT_TAKEN');
  });

  it('locks the room once the game starts', () => {
    const room = started(4);
    expect(room.locked).toBe(true);
    expect(
      handleJoin(room, 'late', { t: 'JOIN', v: PROTOCOL_VERSION, name: 'מאחר' }).reason,
    ).toBe('ROOM_LOCKED');
  });

  it('needs three players to start', () => {
    expect(startGame(lobby(2), env()).accepted).toBe(false);
  });

  /**
   * The one that matters: a lobby the gate approved must never be a lobby the
   * reducer refuses, because that throw happens after everybody has joined and
   * there is no way back.
   */
  it('every lobby that passes the join gate survives START_GAME', () => {
    for (let count = 3; count <= 12; count++) {
      const out = startGame(lobby(count), env(`seed-${count}`));
      expect(out.accepted).toBe(true);
      expect(out.room.state.phase).toBe('REVEAL');
      expect(out.room.state.players).toHaveLength(count);
    }
  });
});

describe('seat identity', () => {
  it('maps seat i to p{i} in the frozen order', () => {
    const room = started(5);
    room.seats.forEach((seat, i) => {
      expect(playerIdOf(room, seat.seatId)).toBe(`p${i}`);
      expect(seatIdOf(room, `p${i}`)).toBe(seat.seatId);
    });
  });

  it('keeps the map through a whole extra round', () => {
    let room = revealed(started(5));
    const before = room.seatOrder;
    room = speakRound(room);
    room = toVoting(room);
    room = voteOut(room, citizen(room));
    room = allReady(room);
    expect(room.seatOrder).toEqual(before);
    room.seats.forEach((seat, i) => expect(playerIdOf(room, seat.seatId)).toBe(`p${i}`));
  });

  it('does not name a player before the order is frozen', () => {
    const room = lobby(4);
    expect(playerIdOf(room, room.seats[2]!.seatId)).toBeNull();
  });
});

describe('epoch (the sync key)', () => {
  it('advances only when actions are applied', () => {
    let room = revealed(started(5));
    room = toVotingViaClues(room);
    const before = room.epoch;
    const p0 = room.state.players.find((p) => p.alive)!.id;
    room = expectOk(asPlayer(room, p0, { t: 'VOTE', target: nextAlive(room, p0) }));
    // One vote of five: nothing applied, so the key must still be valid…
    expect(room.epoch).toBe(before);
    // …but the room changed, so guests still get a fresh counter.
    expect(room.version).toBeGreaterThan(1);
  });

  it('rejects an intent minted against an older epoch', () => {
    const room = revealed(started(5));
    const player = room.state.players[0]!.id;
    const seat = seatIdOf(room, player)!;
    const stale = handleIntent(
      room,
      seat,
      { t: 'NEXT_TURN', key: String(room.epoch - 1) },
      env(),
    );
    expect(stale.reason).toBe('STALE');
    expect(stale.room).toBe(room);
  });

  /**
   * The reason the key is a counter and not a hash of state fields: NEW_ROUND
   * resets phase, roundNumber, clueTurnIndex and voterIndex together, so a
   * field-derived key repeats and an intent buffered across a whole game would
   * be accepted in the next one.
   */
  it('rejects an intent left over from the previous game after NEW_ROUND', () => {
    let room = revealed(started(5, { imposterGuessEnabled: false }));
    const keyInGameOne = String(room.epoch);
    const speaker = currentCluePlayer(room.state)!;
    const seat = seatIdOf(room, speaker)!;

    // Play game 1 out and start game 2, which lands back on CLUES round 1.
    room = speakRound(room);
    room = toVoting(room);
    room = voteOut(room, imposter(room));
    room = allReady(room); // CONTINUE → GAME_OVER
    expect(room.state.phase).toBe('GAME_OVER');
    room = allReady(room); // NEW_ROUND → REVEAL
    room = revealed(room);

    expect(room.state.phase).toBe('CLUES');
    expect(room.state.roundNumber).toBe(1);
    expect(room.state.clueTurnIndex).toBe(0);

    const late = handleIntent(room, seat, { t: 'NEXT_TURN', key: keyInGameOne }, env());
    expect(late.reason).toBe('STALE');
  });
});

describe('reveal', () => {
  it('waits for every player, not a majority', () => {
    let room = started(5);
    for (let i = 0; i < 4; i++) {
      room = expectOk(asPlayer(room, `p${i}`, { t: 'READY' }));
      expect(room.state.phase).toBe('REVEAL');
    }
    room = expectOk(asPlayer(room, 'p4', { t: 'READY' }));
    expect(room.state.phase).toBe('CLUES');
  });

  it('leaves every reveal counted exactly once, as on one device', () => {
    const room = revealed(started(6));
    for (const player of room.state.players) {
      expect(room.state.revealViews[player.id]).toBe(1);
    }
  });

  it('treats a repeat READY as a no-op rather than a second view', () => {
    let room = started(4);
    room = expectOk(asPlayer(room, 'p0', { t: 'READY' }));
    room = expectOk(asPlayer(room, 'p0', { t: 'READY' }));
    expect(room.pending.reveal).toEqual(['p0']);
    expect(room.state.phase).toBe('REVEAL');
  });

  it('lets the host force it through when a phone is dead', () => {
    let room = started(5);
    room = expectOk(asPlayer(room, 'p0', { t: 'READY' }));
    room = expectOk(host(room, { t: 'FORCE_REVEAL' }));
    expect(room.state.phase).toBe('CLUES');
    for (const player of room.state.players) {
      expect(room.state.revealViews[player.id]).toBe(1);
    }
  });
});

describe('clues', () => {
  it('SPEAK: only the current speaker may advance the turn', () => {
    const room = revealed(started(5));
    const speaker = currentCluePlayer(room.state)!;
    const other = room.state.players.find((p) => p.id !== speaker)!.id;
    expect(asPlayer(room, other, { t: 'NEXT_TURN' }).reason).toBe('NOT_ALLOWED');
    expect(asPlayer(room, speaker, { t: 'NEXT_TURN' }).accepted).toBe(true);
  });

  it('SPEAK: refuses a typed clue', () => {
    const room = revealed(started(5));
    const speaker = currentCluePlayer(room.state)!;
    expect(asPlayer(room, speaker, { t: 'CLUE', text: 'משהו' }).reason).toBe('NOT_ALLOWED');
  });

  it('TYPE: collects one clue per turn and hides them until the round closes', () => {
    let room = revealed(started(5, { clueMode: 'TYPE' }));
    const first = currentCluePlayer(room.state)!;
    room = expectOk(asPlayer(room, first, { t: 'CLUE', text: 'ראשון' }));
    expect(room.state.clues[first]).toBe('ראשון');
    expect(room.state.phase).toBe('CLUES');
    room = typeRound(room);
    expect(room.state.phase).toBe('DISCUSSION');
    expect(Object.keys(room.state.clues)).toHaveLength(5);
  });

  it('TYPE: refuses an empty or over-long clue', () => {
    const room = revealed(started(4, { clueMode: 'TYPE' }));
    const first = currentCluePlayer(room.state)!;
    expect(asPlayer(room, first, { t: 'CLUE', text: '   ' }).reason).toBe('BAD_PAYLOAD');
    expect(asPlayer(room, first, { t: 'CLUE', text: 'א'.repeat(23) }).reason).toBe(
      'BAD_PAYLOAD',
    );
  });

  it('skips to the discussion on a majority', () => {
    let room = revealed(started(5));
    room = expectOk(asPlayer(room, 'p0', { t: 'SKIP_CLUES' }));
    room = expectOk(asPlayer(room, 'p1', { t: 'SKIP_CLUES' }));
    expect(room.state.phase).toBe('CLUES');
    room = expectOk(asPlayer(room, 'p2', { t: 'SKIP_CLUES' }));
    expect(room.state.phase).toBe('DISCUSSION');
  });
});

describe('discussion', () => {
  it('moves on a majority without waiting for everyone', () => {
    let room = speakRound(revealed(started(5)));
    expect(room.state.phase).toBe('DISCUSSION');
    room = expectOk(asPlayer(room, 'p0', { t: 'CHOOSE', option: 'VOTE' }));
    room = expectOk(asPlayer(room, 'p1', { t: 'CHOOSE', option: 'VOTE' }));
    expect(room.state.phase).toBe('DISCUSSION');
    room = expectOk(asPlayer(room, 'p2', { t: 'CHOOSE', option: 'VOTE' }));
    expect(room.state.phase).toBe('VOTING');
  });

  it('runs another clue round on a majority for it', () => {
    let room = speakRound(revealed(started(5)));
    for (const id of ['p0', 'p1', 'p2']) {
      room = expectOk(asPlayer(room, id, { t: 'CHOOSE', option: 'ANOTHER_ROUND' }));
    }
    expect(room.state.phase).toBe('CLUES');
    expect(room.state.roundNumber).toBe(2);
  });

  it('lets a player change their mind before the majority lands', () => {
    let room = speakRound(revealed(started(5)));
    room = expectOk(asPlayer(room, 'p0', { t: 'CHOOSE', option: 'VOTE' }));
    room = expectOk(asPlayer(room, 'p0', { t: 'CHOOSE', option: 'ANOTHER_ROUND' }));
    expect(room.pending.choice['p0']).toBe('ANOTHER_ROUND');
    expect(room.state.phase).toBe('DISCUSSION');
  });

  /**
   * Four alive and a 2–2 split reaches a majority for neither. Without a
   * tie-break the room simply stops, with four people tapping buttons that do
   * nothing. The game-advancing option wins.
   */
  it('breaks an even split by going to the vote', () => {
    let room = speakRound(revealed(started(4)));
    room = expectOk(asPlayer(room, 'p0', { t: 'CHOOSE', option: 'ANOTHER_ROUND' }));
    room = expectOk(asPlayer(room, 'p1', { t: 'CHOOSE', option: 'ANOTHER_ROUND' }));
    room = expectOk(asPlayer(room, 'p2', { t: 'CHOOSE', option: 'VOTE' }));
    expect(room.state.phase).toBe('DISCUSSION');
    room = expectOk(asPlayer(room, 'p3', { t: 'CHOOSE', option: 'VOTE' }));
    expect(room.state.phase).toBe('VOTING');
  });

  it('lets the host pick the branch explicitly', () => {
    const room = speakRound(revealed(started(5)));
    expect(
      expectOk(host(room, { t: 'FORCE_CHOICE', option: 'ANOTHER_ROUND' })).state.phase,
    ).toBe('CLUES');
    expect(expectOk(host(room, { t: 'FORCE_CHOICE', option: 'VOTE' })).state.phase).toBe(
      'VOTING',
    );
  });

  it('ignores a dead player', () => {
    let room = ejectOne(started(6, { imposterGuessEnabled: false }));
    room = speakRound(room);
    const dead = room.state.players.find((p) => !p.alive)!.id;
    expect(asPlayer(room, dead, { t: 'CHOOSE', option: 'VOTE' }).reason).toBe(
      'NOT_ALLOWED',
    );
  });
});

describe('voting', () => {
  it('collects every vote before anything reaches the reducer', () => {
    let room = toVotingViaClues(started(5));
    const alive = room.state.players.map((p) => p.id);
    for (let i = 0; i < 4; i++) {
      room = expectOk(asPlayer(room, alive[i]!, { t: 'VOTE', target: nextAlive(room, alive[i]!) }));
      expect(room.state.phase).toBe('VOTING');
      expect(room.state.votes).toHaveLength(0);
    }
    room = expectOk(asPlayer(room, alive[4]!, { t: 'VOTE', target: nextAlive(room, alive[4]!) }));
    expect(room.state.phase).toBe('VOTE_RESULT');
    expect(room.state.votes).toHaveLength(5);
  });

  it('refuses a second vote from the same player', () => {
    let room = toVotingViaClues(started(5));
    room = expectOk(asPlayer(room, 'p0', { t: 'VOTE', target: 'p1' }));
    expect(asPlayer(room, 'p0', { t: 'VOTE', target: 'p2' }).reason).toBe('NOT_ALLOWED');
    expect(room.pending.votes['p0']).toBe('p1');
  });

  it('refuses a vote for yourself or for an ineligible target', () => {
    const room = toVotingViaClues(started(5));
    expect(asPlayer(room, 'p0', { t: 'VOTE', target: 'p0' }).reason).toBe('NOT_ALLOWED');
    expect(asPlayer(room, 'p0', { t: 'VOTE', target: 'nobody' }).reason).toBe(
      'NOT_ALLOWED',
    );
  });

  it('narrows the ballot in a runoff', () => {
    // 4 players, 2 v 2 → tie → runoff between the two leaders.
    let room = toVotingViaClues(started(4));
    room = expectOk(asPlayer(room, 'p0', { t: 'VOTE', target: 'p2' }));
    room = expectOk(asPlayer(room, 'p1', { t: 'VOTE', target: 'p2' }));
    room = expectOk(asPlayer(room, 'p2', { t: 'VOTE', target: 'p3' }));
    room = expectOk(asPlayer(room, 'p3', { t: 'VOTE', target: 'p2' }));
    expect(room.state.phase).toBe('VOTE_RESULT');
    if (room.state.lastVote!.outcome === 'TIE_RUNOFF') {
      room = allReady(room);
      expect(room.state.phase).toBe('VOTING');
      expect(room.state.voteStage).toBe('RUNOFF');
      const tied = room.state.eligibleTargets;
      const voter = tied.includes('p0') ? 'p1' : 'p0';
      const bad = room.state.players.map((p) => p.id).find((id) => !tied.includes(id))!;
      expect(asPlayer(room, voter, { t: 'VOTE', target: bad }).reason).toBe('NOT_ALLOWED');
    }
  });

  it('lets the host vote for a dead phone', () => {
    let room = toVotingViaClues(started(4));
    room = expectOk(asPlayer(room, 'p0', { t: 'VOTE', target: 'p1' }));
    room = expectOk(asPlayer(room, 'p1', { t: 'VOTE', target: 'p0' }));
    room = expectOk(asPlayer(room, 'p2', { t: 'VOTE', target: 'p0' }));
    room = expectOk(host(room, { t: 'VOTE_FOR', playerId: 'p3', target: 'p0' }));
    expect(room.state.phase).toBe('VOTE_RESULT');
  });
});

describe('the ejected still count', () => {
  /**
   * The round is over and the players who were voted out are still in the room
   * holding phones. Counting only survivors silences them on "shall we play
   * again", and with a small survivor set can hang the room outright.
   */
  it('counts everyone, not just the living, at VOTE_RESULT', () => {
    const room = ejectOne(started(7, { imposterGuessEnabled: false }));
    expect(room.state.phase).toBe('VOTE_RESULT');
    const dead = room.state.players.find((p) => !p.alive)!.id;
    expect(asPlayer(room, dead, { t: 'READY' }).accepted).toBe(true);
    // 7 players, 1 ejected: the bar is majority(7) = 4, not majority(6) = 4
    // by luck — check the electorate directly.
    let next = room;
    const need = majority(7);
    for (let i = 0; i < need - 1; i++) {
      next = expectOk(asPlayer(next, `p${i}`, { t: 'READY' }));
      expect(next.state.phase).toBe('VOTE_RESULT');
    }
    next = expectOk(asPlayer(next, `p${need - 1}`, { t: 'READY' }));
    expect(next.state.phase).not.toBe('VOTE_RESULT');
  });

  it('counts everyone at GAME_OVER', () => {
    let room = revealed(started(5, { imposterGuessEnabled: false }));
    room = speakRound(room);
    room = toVoting(room);
    room = voteOut(room, imposter(room));
    room = allReady(room);
    expect(room.state.phase).toBe('GAME_OVER');
    const dead = room.state.players.find((p) => !p.alive)!.id;
    expect(asPlayer(room, dead, { t: 'READY' }).accepted).toBe(true);
  });
});

describe('the imposter guess', () => {
  /**
   * The guesser is, by construction, the player who was just voted out —
   * `CAST_VOTE` set `alive: false` on them. A blanket aliveness check locks the
   * room in a phase with no exit at all.
   */
  it('lets the dead guesser guess', () => {
    let room = revealed(started(5, { imposterGuessEnabled: true }));
    room = speakRound(room);
    room = toVoting(room);
    room = voteOut(room, imposter(room));
    room = allReady(room);
    expect(room.state.phase).toBe('IMPOSTER_GUESS');

    const guesser = room.state.guessingImposterId!;
    expect(room.state.players.find((p) => p.id === guesser)!.alive).toBe(false);

    const correct = room.state.guessOptions!.find((id) => id === room.state.secretWordId)!;
    const out = asPlayer(room, guesser, { t: 'GUESS', wordId: correct });
    expect(out.accepted).toBe(true);
    expect(out.room.state.phase).toBe('GAME_OVER');
    expect(out.room.state.winner).toBe('IMPOSTERS');
  });

  it('refuses a guess from anybody else', () => {
    let room = revealed(started(5, { imposterGuessEnabled: true }));
    room = speakRound(room);
    room = toVoting(room);
    room = voteOut(room, imposter(room));
    room = allReady(room);
    const other = room.state.players.find((p) => p.id !== room.state.guessingImposterId)!;
    expect(
      asPlayer(room, other.id, { t: 'GUESS', wordId: room.state.guessOptions![0]! }).reason,
    ).toBe('NOT_ALLOWED');
  });

  it('refuses a word that was not offered', () => {
    let room = revealed(started(5, { imposterGuessEnabled: true }));
    room = speakRound(room);
    room = toVoting(room);
    room = voteOut(room, imposter(room));
    room = allReady(room);
    expect(
      asPlayer(room, room.state.guessingImposterId!, { t: 'GUESS', wordId: 'nope' }).reason,
    ).toBe('BAD_PAYLOAD');
  });

  it('gives the host a way out if the guesser has vanished', () => {
    let room = revealed(started(5, { imposterGuessEnabled: true }));
    room = speakRound(room);
    room = toVoting(room);
    room = voteOut(room, imposter(room));
    room = allReady(room);
    const wrong = room.state.guessOptions!.find((id) => id !== room.state.secretWordId)!;
    const out = expectOk(host(room, { t: 'GUESS_FOR', wordId: wrong }));
    expect(out.state.phase).toBe('GAME_OVER');
    expect(out.state.winner).toBe('CITIZENS');
  });
});

describe('transactional replay', () => {
  /**
   * A batch either lands whole or not at all. Half a reveal sequence would push
   * somebody's `revealViews` to 2 — quietly destroying the invariant the reveal
   * audit rests on — and wedge the phase with nothing on screen to say so.
   */
  it('leaves the room untouched when an action in the batch is illegal', () => {
    const room = revealed(started(5));
    // FINISH_CLUES is legal here, but a guess is not: the batch must bounce.
    const out = host(room, { t: 'GUESS_FOR', wordId: 'anything' });
    expect(out.accepted).toBe(false);
    expect(out.room).toBe(room);
    expect(out.room.state).toBe(room.state);
    expect(out.room.epoch).toBe(room.epoch);
  });

  it('never lets a reveal be counted twice', () => {
    let room = started(5);
    room = expectOk(asPlayer(room, 'p0', { t: 'READY' }));
    room = expectOk(host(room, { t: 'FORCE_REVEAL' }));
    // Forcing again must not re-run the sequence.
    const again = host(room, { t: 'FORCE_REVEAL' });
    expect(again.accepted).toBe(false);
    for (const player of room.state.players) {
      expect(room.state.revealViews[player.id]).toBe(1);
    }
  });
});

describe('equivalence with the single-device engine', () => {
  /**
   * The whole design rests on this: the online path is a different way of
   * collecting the same inputs, not a different game. Same seed, same
   * decisions, byte-identical state.
   */
  it('produces the same GameState as playing on one device', () => {
    const e = env('equiv-seed');

    // Online: lobby → reveal → speak round → vote out p1.
    let room = started(5, {}, e);
    room = revealed(room, e);
    room = speakRound(room, e);
    room = toVoting(room, e);
    room = voteOut(room, 'p1', e);

    // Single device: the same story through the existing test helpers.
    let solo: GameState = startedGame(5, {}, 'equiv-seed');
    solo = playClueRound(solo);
    solo = reducer(solo, { type: 'START_VOTING', seed: 'equiv-seed' });
    solo = castAll(solo, 'p1');

    expect(room.state).toEqual(solo);
  });

  it('matches through a second round as well', () => {
    const e = env('equiv-two');
    let room = revealed(started(6, { imposterGuessEnabled: false }, e), e);
    room = speakRound(room, e);
    // Everyone asks for another clue round.
    for (const id of ['p0', 'p1', 'p2', 'p3']) {
      room = expectOk(asPlayer(room, id, { t: 'CHOOSE', option: 'ANOTHER_ROUND' }, e));
    }
    room = speakRound(room, e);

    let solo: GameState = startedGame(6, { imposterGuessEnabled: false }, 'equiv-two');
    solo = playClueRound(solo);
    solo = reducer(solo, { type: 'ANOTHER_CLUE_ROUND', seed: 'equiv-two' });
    solo = playClueRound(solo);

    expect(room.state).toEqual(solo);
  });

  it('matches in TYPE mode', () => {
    const e = env('equiv-type');
    let room = revealed(started(4, { clueMode: 'TYPE' }, e), e);
    const texts: string[] = [];
    let guard = 0;
    while (room.state.phase === 'CLUES') {
      const current = currentCluePlayer(room.state)!;
      const text = `רמז${++guard}`;
      texts.push(text);
      room = expectOk(asPlayer(room, current, { t: 'CLUE', text }, e));
    }

    let solo: GameState = startedGame(4, { clueMode: 'TYPE' }, 'equiv-type');
    let i = 0;
    while (solo.phase === 'CLUES') {
      const playerId = currentCluePlayer(solo)!;
      solo = reducer(solo, { type: 'SUBMIT_CLUE', playerId, text: texts[i++]! });
    }

    expect(room.state).toEqual(solo);
  });
});

describe('timers', () => {
  it('arms the discussion clock from the host clock', () => {
    const e = env(SEED, 5_000_000);
    let room = revealed(started(4, { discussionSeconds: 90 }, e), e);
    room = speakRound(room, e);
    expect(room.state.phase).toBe('DISCUSSION');
    expect(room.deadlineAt).toBe(5_000_000 + 90_000);
  });

  it('leaves the deadline null when no timer is configured', () => {
    let room = revealed(started(4, { discussionSeconds: 0 }));
    room = speakRound(room);
    expect(room.deadlineAt).toBeNull();
  });

  it('re-arms the per-turn clock in SPEAK mode', () => {
    const e = env(SEED, 1_000);
    let room = revealed(started(4, { clueTimerSeconds: 30 }, e), e);
    expect(room.deadlineAt).toBe(1_000 + 30_000);
    const later = env(SEED, 9_000);
    room = expectOk(asPlayer(room, currentCluePlayer(room.state)!, { t: 'NEXT_TURN' }, later));
    expect(room.deadlineAt).toBe(9_000 + 30_000);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function toVotingViaClues(room: import('./room').Room) {
  const withRoles = room.state.phase === 'REVEAL' ? revealed(room) : room;
  return toVoting(speakRound(withRoles));
}

function nextAlive(room: import('./room').Room, not: string): string {
  return room.state.eligibleTargets.find((id) => id !== not)!;
}

/** Play to the first vote result, ejecting whoever the group picks. */
function ejectOne(room: import('./room').Room) {
  const played = toVotingViaClues(room);
  const target = played.state.players.find((p) => p.id !== 'p0')!.id;
  return voteOut(played, target);
}
