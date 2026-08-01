/**
 * The online rulebook. Pure: no React, no network, no `Date.now()`, no
 * `Math.random()`. Everything impure arrives in `env`.
 *
 * Three properties make the whole design work, and all three are load-bearing:
 *
 *  1. **Intents, not actions.** A guest says "I want to vote for p3". The
 *     driver decides when the reducer hears about it, and in what order. That
 *     is how six people vote at once against a reducer that insists on strict
 *     turn order, without changing one line of `src/game/`.
 *
 *  2. **Synchronous authority.** The driver hands back a new `Room`; the caller
 *     stores it before doing anything else. There is no window in which a
 *     second intent from the same burst is validated against a state that has
 *     already moved on — the bug you get for free if you validate against a
 *     `useReducer` state that has not re-rendered yet.
 *
 *  3. **Transactional replay.** A batch of actions is folded through the
 *     reducer on a local copy first. If any of them throws, the whole batch is
 *     dropped and `pending` is kept. Half-applying a reveal sequence would
 *     leave `revealViews` at 2 for somebody, quietly destroying the one
 *     invariant the reveal audit rests on, and wedge the phase with no error.
 */

import { reducer } from '../game/reducer';
import { aliveIds, currentCluePlayer, playerById, voteTargetsFor } from '../game/rules';
import { normalize } from '../game/niqqud';
import { findWordEntry } from '../game/words';
import {
  MIN_PLAYERS,
  type Action,
  type GameState,
  type PlayerId,
} from '../game/types';
import {
  MAX_CLUE_LENGTH,
  PROTOCOL_VERSION,
  type ChoiceOption,
  type GuestMessage,
  type HostCommand,
  type RejectReason,
  type SeatId,
} from './protocol';
import {
  emptyPending,
  nextSeatId,
  playerIdOf,
  seatById,
  seatByConn,
  seatIdOf,
  validateJoin,
  type Pending,
  type Room,
  type Seat,
} from './room';
import {
  electorate,
  neededFor,
  pendingSetFor,
  resolveChoice,
  waitingKind,
} from './thresholds';

/** Everything impure the driver needs, injected so it stays testable. */
export type Env = {
  /** Fresh randomness for the actions that take a seed. */
  seed: string;
  /** The host's wall clock, for arming timers. */
  now: number;
};

export type Outcome = {
  room: Room;
  accepted: boolean;
  reason?: RejectReason;
};

export type JoinOutcome = Outcome & {
  seatId?: SeatId;
  /**
   * The connection that was holding this seat and no longer does.
   *
   * The caller owes it a terminal `SEAT_TAKEN` before hanging up, or it goes on
   * retrying and the two channels take turns evicting each other.
   */
  displaced?: string;
};

const reject = (room: Room, reason: RejectReason): Outcome => ({
  room,
  accepted: false,
  reason,
});

/** Any change at all: re-render and re-broadcast, but intents stay valid. */
function touch(room: Room, patch: Partial<Room>): Room {
  return { ...room, ...patch, version: room.version + 1 };
}

// ── applying actions ─────────────────────────────────────────────────────────

/**
 * Fold a batch through the reducer, all or nothing.
 *
 * Returns null if any action is refused, in which case the caller must leave
 * the room exactly as it was. This is what makes "the replay is always a legal
 * sequence" a fact rather than a hope.
 */
function foldActions(state: GameState, actions: Action[]): GameState | null {
  let next = state;
  try {
    for (const action of actions) next = reducer(next, action);
    return next;
  } catch {
    return null;
  }
}

/** Which timer, if any, the phase we just landed in should arm. */
function timerSeconds(state: GameState): number {
  if (state.phase === 'DISCUSSION') return state.settings.discussionSeconds;
  if (state.phase === 'CLUES' && state.settings.clueMode === 'SPEAK') {
    return state.settings.clueTimerSeconds;
  }
  return 0;
}

/**
 * Commit a batch: fold it, and on success bump `epoch` (so every outstanding
 * intent minted against the old state is now stale), clear the buffers, and
 * re-arm the clock.
 */
function commit(room: Room, actions: Action[], env: Env): Outcome {
  const next = foldActions(room.state, actions);
  if (next === null) return reject(room, 'NOT_ALLOWED');

  const phaseMoved =
    next.phase !== room.state.phase ||
    next.clueTurnIndex !== room.state.clueTurnIndex ||
    next.roundNumber !== room.state.roundNumber;

  // Requests to cut the clue round short outlive the turns they were made
  // during: a round advances one player at a time, and clearing the tally on
  // every turn means five players can never assemble three requests. They go
  // when the round does.
  const sameRound =
    next.phase === 'CLUES' &&
    room.state.phase === 'CLUES' &&
    next.roundNumber === room.state.roundNumber;
  const keep: Partial<Pending> = sameRound ? { skip: room.pending.skip } : {};

  const seconds = timerSeconds(next);
  const deadlineAt = phaseMoved
    ? seconds > 0
      ? env.now + seconds * 1000
      : null
    : room.deadlineAt;

  return {
    room: {
      ...room,
      state: next,
      pending: { ...emptyPending(), ...keep },
      epoch: room.epoch + 1,
      version: room.version + 1,
      deadlineAt,
    },
    accepted: true,
  };
}

// ── joining ──────────────────────────────────────────────────────────────────

export function handleJoin(
  room: Room,
  connId: string,
  msg: Extract<GuestMessage, { t: 'JOIN' }>,
  /** The secret to issue if this turns out to be a new seat. */
  newToken: string,
): JoinOutcome {
  if (msg.v !== PROTOCOL_VERSION) return reject(room, 'BAD_VERSION');

  // A repeat JOIN over a channel that already holds a seat is the ordinary
  // consequence of React's StrictMode double-mount, and of a guest retrying
  // before its first attempt was acknowledged. It must be idempotent, or the
  // second attempt gets NAME_TAKEN by the first.
  const existing = seatByConn(room, connId);
  if (existing) {
    return { room, accepted: true, seatId: existing.seatId };
  }

  // Reconnecting to a seat we already hold.
  if (msg.seatId !== undefined) {
    const seat = seatById(room, msg.seatId);
    // Both halves are load-bearing, and neither is paranoia.
    //
    // The host's seat has no channel behind it — it belongs to the tab running
    // this code — so no reconnect to it is ever legitimate, and `s0` is not
    // hard to guess.
    //
    // Every other seat needs the token, because `s1`…`s11` are not secrets
    // either. Anyone holding the room code could otherwise name a seat that is
    // not theirs and be handed its projected view — the reveal card, and with
    // it the word and, by comparison across seats, the imposter — along with
    // the ability to vote as that player and, since the takeover is silent to
    // them and terminal, to put them out of the game.
    if (seat && !seat.isHost && msg.token !== undefined && seat.token === msg.token) {
      // The new channel takes the seat even when the old one still looks live.
      //
      // Refusing would be the cautious-looking choice and it is the wrong one:
      // a phone that drops off retries after one second, while the host only
      // learns the old channel is dead when peerjs times the ICE connection
      // out, several seconds later. In that window every reconnect names a
      // seat whose `connId` is still set — so refusing locks a player out of a
      // game they are standing in the room for, and their seat goes on
      // counting toward every threshold. Two tabs on one phone is a far rarer
      // problem, and it costs that phone a refresh rather than the room a
      // player.
      // The name is deliberately NOT taken from the JOIN. A reconnect says
      // "I am back", not "call me this" — and the name in a guest's JOIN comes
      // from a prop captured at mount, so honouring it would silently revert
      // every rename on the next blip. `RENAME` is the only way to change one.
      const seats = room.seats.map((s) =>
        s.seatId === seat.seatId ? { ...s, connId } : s,
      );
      const displaced =
        seat.connId !== null && seat.connId !== connId ? seat.connId : undefined;
      return {
        room: touch(room, { seats }),
        accepted: true,
        seatId: seat.seatId,
        displaced,
      };
    }
    // Unknown seat id in a locked room: a stale session from an older game.
    if (room.locked) return reject(room, 'ROOM_LOCKED');
  }

  const bad = validateJoin(room, msg.name);
  if (bad) return reject(room, bad);

  const seat: Seat = {
    seatId: nextSeatId(room),
    name: normalize(msg.name.trim()),
    connId,
    isHost: false,
    token: newToken,
  };
  return {
    room: touch(room, { seats: [...room.seats, seat] }),
    accepted: true,
    seatId: seat.seatId,
  };
}

/**
 * Change a seated player's display name.
 *
 * Only while the room is open: once the game starts the roster is frozen into
 * `state.players` and the reducer owns those names. Validated through exactly
 * the gate `START_GAME` will later apply, so a name accepted here can never be
 * a name that makes the game refuse to start.
 */
export function renameSeat(room: Room, seatId: SeatId, name: string): Outcome {
  if (room.locked) return reject(room, 'NOT_ALLOWED');
  const seat = seatById(room, seatId);
  if (!seat) return reject(room, 'NOT_ALLOWED');
  const bad = validateJoin(room, name, seatId);
  if (bad) return reject(room, bad);
  const next = normalize(name.trim());
  if (next === seat.name) return { room, accepted: true };
  return {
    room: touch(room, {
      seats: room.seats.map((s) => (s.seatId === seatId ? { ...s, name: next } : s)),
    }),
    accepted: true,
  };
}

/**
 * A channel is gone. Whether the seat goes with it depends on *why*.
 *
 * `LEFT` is somebody saying so: the Leave button, or the tab actually closing.
 * In the lobby that frees the seat, which is what keeps a roster from filling
 * with people who went home.
 *
 * `SILENT` is only an absence of heartbeats, and the two are not the same
 * thing. A phone that locks or a tab that is backgrounded stops sending for
 * ten seconds and then comes back — and deleting a lobby seat for that made
 * the player vanish from the host's screen entirely: not greyed out, not
 * "מנותק", gone, with nothing to tell the host to wait. If the host started
 * the game in that window, the returning player got `ROOM_LOCKED`, which is
 * terminal. A silent seat stays and shows as disconnected, with an × beside
 * it for the case where they really have gone home.
 */
export type DropReason = 'LEFT' | 'SILENT';

export function dropConnection(
  room: Room,
  connId: string,
  why: DropReason = 'SILENT',
): Room {
  const seat = seatByConn(room, connId);
  if (!seat) return room;
  // The host's own seat always stays.
  if (why === 'LEFT' && !room.locked && !seat.isHost) {
    return touch(room, { seats: room.seats.filter((s) => s.seatId !== seat.seatId) });
  }
  return touch(room, {
    seats: room.seats.map((s) => (s.seatId === seat.seatId ? { ...s, connId: null } : s)),
  });
}

// ── starting ─────────────────────────────────────────────────────────────────

/**
 * Lobby → live game.
 *
 * The dispatch order matters and is not interchangeable: `UPDATE_SETTINGS`
 * clamps `imposterCount` against the roster, but only once there *is* a roster
 * (`reducer.ts` guards it with `players.length > 0`). Settings chosen in the
 * lobby therefore have to land after the players, not before.
 */
export function startGame(room: Room, env: Env): Outcome {
  if (room.locked) return reject(room, 'NOT_ALLOWED');
  if (room.state.phase !== 'SETUP') return reject(room, 'NOT_ALLOWED');
  if (room.seats.length < MIN_PLAYERS) return reject(room, 'NOT_ALLOWED');

  const seatOrder = room.seats.map((s) => s.seatId);
  const actions: Action[] = [
    { type: 'SET_PLAYERS', names: room.seats.map((s) => s.name) },
    { type: 'UPDATE_SETTINGS', patch: room.settings },
    { type: 'START_GAME', seed: env.seed },
  ];

  const next = foldActions(room.state, actions);
  if (next === null) return reject(room, 'NOT_ALLOWED');

  return {
    room: {
      ...room,
      state: next,
      seatOrder,
      locked: true,
      settings: next.settings,
      pending: emptyPending(),
      epoch: room.epoch + 1,
      version: room.version + 1,
      deadlineAt: null,
    },
    accepted: true,
  };
}

// ── authorisation ────────────────────────────────────────────────────────────

/**
 * May this player send this intent, right now?
 *
 * The trap here is a blanket "must be alive" check. The one player who may act
 * during IMPOSTER_GUESS is the imposter who was just voted out, and
 * `CAST_VOTE` set `alive: false` on them on the way in. Rejecting them locks
 * the room in a phase with no exit.
 */
function authorise(
  room: Room,
  playerId: PlayerId,
  msg: GuestMessage,
): RejectReason | null {
  const state = room.state;
  const alive = playerById(state, playerId).alive;

  switch (msg.t) {
    case 'READY':
      if (state.phase === 'REVEAL') return alive ? null : 'NOT_ALLOWED';
      // The round is over; ejected players are still in the room and still get
      // a say in whether to play on.
      if (state.phase === 'VOTE_RESULT' || state.phase === 'GAME_OVER') return null;
      return 'NOT_ALLOWED';

    case 'CHOOSE':
      if (state.phase !== 'DISCUSSION') return 'NOT_ALLOWED';
      return alive ? null : 'NOT_ALLOWED';

    case 'SKIP_CLUES':
      if (state.phase !== 'CLUES') return 'NOT_ALLOWED';
      return alive ? null : 'NOT_ALLOWED';

    case 'VOTE': {
      if (state.phase !== 'VOTING') return 'NOT_ALLOWED';
      if (!alive) return 'NOT_ALLOWED';
      if (!voteTargetsFor(state, playerId).includes(msg.target)) return 'NOT_ALLOWED';
      return null;
    }

    case 'NEXT_TURN':
      if (state.phase !== 'CLUES') return 'NOT_ALLOWED';
      if (state.settings.clueMode !== 'SPEAK') return 'NOT_ALLOWED';
      return currentCluePlayer(state) === playerId ? null : 'NOT_ALLOWED';

    case 'CLUE': {
      if (state.phase !== 'CLUES') return 'NOT_ALLOWED';
      if (state.settings.clueMode !== 'TYPE') return 'NOT_ALLOWED';
      if (currentCluePlayer(state) !== playerId) return 'NOT_ALLOWED';
      const text = msg.text.trim();
      if (text.length === 0) return 'BAD_PAYLOAD';
      if (text.length > MAX_CLUE_LENGTH) return 'BAD_PAYLOAD';
      return null;
    }

    case 'GUESS': {
      if (state.phase !== 'IMPOSTER_GUESS') return 'NOT_ALLOWED';
      // Deliberately not an aliveness check: the guesser is dead by definition.
      if (state.guessingImposterId !== playerId) return 'NOT_ALLOWED';
      if (!state.guessOptions?.includes(msg.wordId)) return 'BAD_PAYLOAD';
      if (!findWordEntry(msg.wordId)) return 'BAD_PAYLOAD';
      return null;
    }

    default:
      return 'NOT_ALLOWED';
  }
}

// ── the reveal fast-forward ──────────────────────────────────────────────────

/**
 * Walk the reducer's one-at-a-time reveal to its end in a single batch.
 *
 * Online, everyone has already seen their own word on their own phone; the
 * reducer's sequence is now bookkeeping, and running it start to finish keeps
 * `revealViews` landing on exactly 1 per player, exactly as on one device.
 */
function revealActions(state: GameState): Action[] {
  const actions: Action[] = [];
  const remaining = state.revealOrder.length - state.revealIndex;
  for (let i = 0; i < remaining; i++) {
    actions.push({ type: 'SHOW_ROLE' }, { type: 'HIDE_ROLE' });
  }
  return actions;
}

/** Replay collected votes in the order the reducer expects to hear them. */
function voteActions(state: GameState, votes: Record<PlayerId, PlayerId>): Action[] {
  return state.voterOrder
    .slice(state.voterIndex)
    .filter((voter) => votes[voter] !== undefined)
    .map((voter) => ({ type: 'CAST_VOTE' as const, voter, target: votes[voter]! }));
}

// ── intents ──────────────────────────────────────────────────────────────────

export function handleIntent(
  room: Room,
  seatId: SeatId,
  msg: GuestMessage,
  env: Env,
): Outcome {
  // Handled by the connection layer, not the rulebook. RENAME is among them:
  // it is a lobby operation, and `handleIntent` refuses everything in SETUP and
  // needs a player id that does not exist until the game starts.
  if (
    msg.t === 'JOIN' ||
    msg.t === 'LEAVE' ||
    msg.t === 'PING' ||
    msg.t === 'RENAME'
  ) {
    return reject(room, 'BAD_PAYLOAD');
  }

  // The key is checked before anything else, and deliberately so. If the game
  // has moved on, the tap refers to a screen that no longer exists, and nothing
  // else about the message can be judged meaningfully against the current room
  // anyway — the player, the phase and the turn have all had a chance to
  // change. It is also the only refusal a guest can act on by itself: STALE is
  // swallowed and answered with a fresh view, while every other reason paints a
  // red banner. Judging phase first meant a tap left over from the last game
  // came back as NOT_ALLOWED and put an error on a screen that was simply late.
  if (msg.key !== String(room.epoch)) return reject(room, 'STALE');

  const playerId = playerIdOf(room, seatId);
  if (playerId === null) return reject(room, 'NOT_ALLOWED');
  if (room.state.phase === 'SETUP') return reject(room, 'NOT_ALLOWED');

  const denied = authorise(room, playerId, msg);
  if (denied) return reject(room, denied);

  return applyIntent(room, playerId, msg, env);
}

function applyIntent(
  room: Room,
  playerId: PlayerId,
  msg: GuestMessage,
  env: Env,
): Outcome {
  const state = room.state;

  switch (msg.t) {
    case 'READY': {
      if (state.phase === 'REVEAL') {
        if (room.pending.reveal.includes(playerId)) return { room, accepted: true };
        const reveal = [...room.pending.reveal, playerId];
        const need = neededFor(state, 'REVEAL');
        if (reveal.length < need) {
          return { room: touch(room, { pending: { ...room.pending, reveal } }), accepted: true };
        }
        return commit(room, revealActions(state), env);
      }

      // VOTE_RESULT / GAME_OVER
      if (room.pending.ready.includes(playerId)) return { room, accepted: true };
      const ready = [...room.pending.ready, playerId];
      if (ready.length < neededFor(state, 'READY')) {
        return { room: touch(room, { pending: { ...room.pending, ready } }), accepted: true };
      }
      const action: Action =
        state.phase === 'VOTE_RESULT'
          ? { type: 'CONTINUE', seed: env.seed }
          : { type: 'NEW_ROUND', seed: env.seed };
      return commit(room, [action], env);
    }

    case 'CHOOSE': {
      const choice: Record<PlayerId, ChoiceOption> = {
        ...room.pending.choice,
        [playerId]: msg.option,
      };
      const decided = resolveChoice(state, choice);
      if (decided === null) {
        return { room: touch(room, { pending: { ...room.pending, choice } }), accepted: true };
      }
      const action: Action =
        decided === 'VOTE'
          ? { type: 'START_VOTING', seed: env.seed }
          : { type: 'ANOTHER_CLUE_ROUND', seed: env.seed };
      return commit(room, [action], env);
    }

    case 'SKIP_CLUES': {
      if (room.pending.skip.includes(playerId)) return { room, accepted: true };
      const skip = [...room.pending.skip, playerId];
      if (skip.length < neededFor(state, 'CLUE')) {
        return { room: touch(room, { pending: { ...room.pending, skip } }), accepted: true };
      }
      return commit(room, [{ type: 'FINISH_CLUES' }], env);
    }

    case 'VOTE': {
      // A cast vote is final — the single-device screen says so in as many
      // words. A second tap is a screen that has not caught up yet, not an
      // error to shout about, so it is swallowed rather than rejected: a
      // rejection here would put a red banner over the rest of the game.
      if (room.pending.votes[playerId] !== undefined) return { room, accepted: true };
      const votes = { ...room.pending.votes, [playerId]: msg.target };
      if (Object.keys(votes).length < neededFor(state, 'VOTE')) {
        return { room: touch(room, { pending: { ...room.pending, votes } }), accepted: true };
      }
      return commit(room, voteActions(state, votes), env);
    }

    case 'NEXT_TURN':
      return commit(room, [{ type: 'NEXT_CLUE_TURN' }], env);

    case 'CLUE':
      // Trimmed here as well as in the reducer, so the driver's own contract
      // holds: `authorise` measured the trimmed text, and passing on something
      // else means what was approved and what is dispatched are different
      // values. Nothing depends on `src/game/` also trimming, which it does.
      return commit(room, [{ type: 'SUBMIT_CLUE', playerId, text: msg.text.trim() }], env);

    case 'GUESS':
      return commit(room, [{ type: 'SUBMIT_GUESS', wordId: msg.wordId }], env);

    default:
      return reject(room, 'NOT_ALLOWED');
  }
}

// ── host overrides ───────────────────────────────────────────────────────────

/**
 * The way out when a phone dies mid-phase.
 *
 * These bypass the "who may send this" checks but go through the same commit
 * path, so an override can never produce a state the ordinary flow could not.
 */
export function hostCommand(room: Room, cmd: HostCommand, env: Env): Outcome {
  const state = room.state;

  switch (cmd.t) {
    case 'FORCE_REVEAL':
      if (state.phase !== 'REVEAL') return reject(room, 'NOT_ALLOWED');
      return commit(room, revealActions(state), env);

    case 'SKIP_TURN': {
      if (state.phase !== 'CLUES') return reject(room, 'NOT_ALLOWED');
      const playerId = currentCluePlayer(state);
      if (playerId === null) return reject(room, 'NOT_ALLOWED');
      // In SPEAK mode the turn is just a marker and skipping it is free. In
      // TYPE mode the reducer will not move on without a clue, so the skipped
      // player is entered with a dash — the round has to survive, and ending
      // it outright is what the button used to do while claiming otherwise.
      return state.settings.clueMode === 'SPEAK'
        ? commit(room, [{ type: 'NEXT_CLUE_TURN' }], env)
        : commit(room, [{ type: 'SUBMIT_CLUE', playerId, text: SKIPPED_CLUE }], env);
    }

    case 'FORCE_CHOICE': {
      if (state.phase !== 'DISCUSSION') return reject(room, 'NOT_ALLOWED');
      const action: Action =
        cmd.option === 'VOTE'
          ? { type: 'START_VOTING', seed: env.seed }
          : { type: 'ANOTHER_CLUE_ROUND', seed: env.seed };
      return commit(room, [action], env);
    }

    case 'DROP_SEAT': {
      // Only in the lobby: once `seatOrder` is frozen, removing a seat would
      // leave the map pointing at somebody who is no longer there.
      if (room.locked) return reject(room, 'NOT_ALLOWED');
      const seat = seatById(room, cmd.seatId);
      if (!seat || seat.isHost) return reject(room, 'NOT_ALLOWED');
      return {
        room: touch(room, {
          seats: room.seats.filter((s) => s.seatId !== cmd.seatId),
        }),
        accepted: true,
      };
    }

    case 'RENAME_SEAT':
      return renameSeat(room, cmd.seatId, cmd.name);

    case 'REOPEN':
      return reopen(room, env);

    case 'FORCE_ADVANCE':
      return forceAdvance(room, env);
  }
}

/**
 * Back to the lobby after a finished game.
 *
 * The only way to change settings between rounds: `UPDATE_SETTINGS` is legal
 * in `SETUP` alone, and the room is locked from the moment play begins. It also
 * lets somebody who arrived late finally join.
 *
 * Two things this must do beyond the obvious, both learned the hard way:
 *
 *  • **Drop seats that have nobody behind them.** A player who dropped out
 *    mid-game left a seat parked with `connId: null`. Unlocking the room does
 *    not give that seat a channel, so the sweep can never reap it — it would be
 *    immortal, get frozen into the next `seatOrder`, be dealt a role, and count
 *    toward every threshold. A game waiting on a phone that went home.
 *  • **Move the epoch on.** A `READY` still in flight from the final screen
 *    lands after the reopen. Without a new epoch it is `NOT_ALLOWED`, which
 *    paints a red banner over the lobby; with one it is `STALE`, which the
 *    guest swallows and corrects itself.
 */
function reopen(room: Room, env: Env): Outcome {
  if (room.state.phase !== 'GAME_OVER') return reject(room, 'NOT_ALLOWED');
  const out = commit(room, [{ type: 'BACK_TO_SETUP' }], env);
  if (!out.accepted) return out;
  return {
    room: {
      ...out.room,
      locked: false,
      seatOrder: null,
      seats: out.room.seats.filter((s) => s.isHost || s.connId !== null),
      version: out.room.version + 1,
    },
    accepted: true,
  };
}

/** What a player who never typed a clue is recorded as having said. */
const SKIPPED_CLUE = '—';

/**
 * "Get on with it", for every phase.
 *
 * `DISCUSSION` is the one that cannot be answered generically — it has two
 * successors — so `FORCE_CHOICE` carries the option instead and this falls
 * back to the game-advancing one.
 */
function forceAdvance(room: Room, env: Env): Outcome {
  const state = room.state;
  switch (state.phase) {
    case 'REVEAL':
      return commit(room, revealActions(state), env);
    case 'CLUES':
      return commit(room, [{ type: 'FINISH_CLUES' }], env);
    case 'DISCUSSION':
      return commit(room, [{ type: 'START_VOTING', seed: env.seed }], env);
    case 'VOTING':
      return commit(room, voteActions(state, closeVote(room)), env);
    case 'VOTE_RESULT':
      return commit(room, [{ type: 'CONTINUE', seed: env.seed }], env);
    case 'IMPOSTER_GUESS':
      return commit(room, [{ type: 'SUBMIT_GUESS', wordId: forfeitGuess(state) }], env);
    case 'GAME_OVER':
      return commit(room, [{ type: 'NEW_ROUND', seed: env.seed }], env);
    default:
      return reject(room, 'NOT_ALLOWED');
  }
}

/**
 * Fill in the votes of players who never cast one.
 *
 * The engine will not resolve a vote without one from every living player, so
 * a dead phone has to be answered somehow. Copying whoever the room is already
 * leaning toward is the least distorting choice available: it cannot invent a
 * leader who had no votes, and it cannot rescue somebody the room had already
 * settled on. With nothing cast at all there is no lean to follow, and the
 * first legal target is as good as any.
 */
function closeVote(room: Room): Record<PlayerId, PlayerId> {
  const state = room.state;
  const votes = { ...room.pending.votes };

  const counts = new Map<PlayerId, number>();
  for (const target of Object.values(votes)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  // Ties in the lean are broken by roster order, so the result is stable.
  let lean: PlayerId | null = null;
  let best = 0;
  for (const player of state.players) {
    const count = counts.get(player.id) ?? 0;
    if (count > best) {
      best = count;
      lean = player.id;
    }
  }

  for (const voter of aliveIds(state)) {
    if (votes[voter] !== undefined) continue;
    const options = voteTargetsFor(state, voter);
    const pick = lean !== null && options.includes(lean) ? lean : options[0];
    if (pick) votes[voter] = pick;
  }
  return votes;
}

/**
 * The guess a vanished imposter is recorded as having made.
 *
 * Deliberately a wrong one. The phase exists to give a caught imposter a last
 * chance, and a player who is not there has not taken it — handing them a one
 * in four shot at stealing the game would be the greater unfairness.
 */
function forfeitGuess(state: GameState): string {
  const options = state.guessOptions ?? [];
  return options.find((id) => id !== state.secretWordId) ?? options[0] ?? '';
}

/**
 * Is the room actually waiting on a player who is not there?
 *
 * Precision matters more than it looks. A blunt "anybody offline" lights the
 * host's override warning through a perfectly healthy clue round — where the
 * only person anyone is waiting on is the current speaker — and a host who
 * learns to ignore an amber light will ignore it in the phase that really is
 * stuck.
 */
export function blockedOnDisconnected(room: Room): boolean {
  const state = room.state;
  if (!room.seatOrder) return false;

  const offline = (playerId: PlayerId | null): boolean => {
    if (playerId === null) return false;
    const seatId = seatIdOf(room, playerId);
    const seat = seatId === null ? undefined : seatById(room, seatId);
    return seat?.connId === null;
  };

  // One player at a time, so only that player can hold things up.
  if (state.phase === 'CLUES') return offline(currentCluePlayer(state));
  if (state.phase === 'IMPOSTER_GUESS') return offline(state.guessingImposterId);

  const kind = waitingKind(state);
  if (kind === null) return false;
  const done = pendingSetFor(room, kind);
  return electorate(state, kind).some((id) => !done.includes(id) && offline(id));
}
