/**
 * THE SECURITY BOUNDARY — read this before changing anything here.
 *
 * This is the only code that decides what a player is allowed to see, and the
 * only thing that ever goes onto the wire. A raw `GameState` carries
 * `players[].isImposter`, `imposterIds`, `secretWordId` and `hintWord`; on one
 * device that is fine, because the device *is* the group. With six phones it is
 * the whole game, so nothing here may pass a field through without deciding,
 * explicitly, who may read it.
 *
 * Two guarantees, both tested in `view.test.ts`:
 *
 *  1. **No leak.** Nothing in a serialized view names the imposter or the
 *     secret word before GAME_OVER — including indirectly, through array
 *     ordering or derived counts.
 *  2. **No tell.** In HIDDEN mode an imposter's view and a citizen's view are
 *     deep-equal once the handful of fields that are *supposed* to differ are
 *     blanked. Not "the same keys" — the same values. A view that leaked the
 *     role through, say, the ordering of a waiting list would pass a key-set
 *     check and fail this one.
 */

import {
  getRevealView,
  getSecretEntry,
  playerById,
  voteTargetsFor,
} from '../game/rules';
import { getWordEntry } from '../game/words';
import type {
  ImposterHintKind,
  Phase,
  PlayerId,
  RevealView,
  Settings,
  VoteResult,
  Winner,
} from '../game/types';
import type { ChoiceOption } from './protocol';
import { isConnected, playerIdOf, seatIdOf, type Room } from './room';
import {
  choiceTally,
  electorate,
  neededFor,
  pendingSetFor,
  waitingKind,
} from './thresholds';

export type ViewPlayer = {
  id: PlayerId;
  name: string;
  alive: boolean;
  connected: boolean;
};

export type WaitingKind = 'REVEAL' | 'CLUE' | 'VOTE' | 'READY' | 'CHOOSE';

export type Waiting = {
  kind: WaitingKind;
  done: number;
  needed: number;
  total: number;
  youDone: boolean;
  /**
   * Who is still holding things up. Always emitted in `state.players` order —
   * entry order, which has nothing to do with roles. Ordering it by anything
   * derived from the game (say, a Set built while walking `imposterIds`) would
   * be a tell.
   */
  names: string[];
};

export type GuessOption = { id: string; word: string };

export type Ending = {
  secretWord: string;
  hintWord: string;
  hintKind: ImposterHintKind;
  category: string;
  imposterIds: PlayerId[];
  guessResult: 'CORRECT' | 'WRONG' | null;
  winner: Winner | null;
};

export type PlayerView = {
  v: number;
  /** The room's epoch. Guests echo it back so stale taps can be rejected. */
  key: string;
  you: { id: PlayerId; name: string; isHost: boolean; alive: boolean };
  phase: Phase;
  roundNumber: number;
  settings: Settings;
  players: ViewPlayer[];

  waiting: Waiting | null;
  deadlineAt: number | null;
  /** The host's clock at send time, so guests can correct for phone skew. */
  serverNow: number;

  // REVEAL — yours and only yours.
  reveal: RevealView | null;

  // CLUES
  turnOrder: PlayerId[];
  discussionOrder: PlayerId[];
  currentPlayerId: PlayerId | null;
  isYourTurn: boolean;
  /** Held back entirely until the clue round closes. */
  clues: Record<PlayerId, string> | null;

  // DISCUSSION
  yourChoice: ChoiceOption | null;
  choiceTally: { VOTE: number; ANOTHER_ROUND: number };

  // VOTING
  voteTargets: PlayerId[];
  voteStage: 'FIRST' | 'RUNOFF';
  youVoted: boolean;

  // VOTE_RESULT
  lastVote: VoteResult | null;

  // IMPOSTER_GUESS — options go to the guesser alone.
  guessOptions: GuessOption[] | null;
  guessingPlayerId: PlayerId | null;

  // GAME_OVER
  ending: Ending | null;

  // Lobby
  lobby: { code: string; names: string[]; hostName: string } | null;
};

/**
 * The lobby view. Deliberately a separate path: `getRevealView` and
 * `getSecretEntry` throw when no word has been drawn, so the SETUP phase must
 * never fall through to the game projection.
 */
function lobbyView(room: Room, seatId: string, now: number): PlayerView {
  const seat = room.seats.find((s) => s.seatId === seatId)!;
  return {
    v: room.version,
    key: String(room.epoch),
    you: { id: 'p?', name: seat.name, isHost: seat.isHost, alive: true },
    phase: 'SETUP',
    roundNumber: 0,
    settings: room.settings,
    players: [],
    waiting: null,
    deadlineAt: null,
    serverNow: now,
    reveal: null,
    turnOrder: [],
    discussionOrder: [],
    currentPlayerId: null,
    isYourTurn: false,
    clues: null,
    yourChoice: null,
    choiceTally: { VOTE: 0, ANOTHER_ROUND: 0 },
    voteTargets: [],
    voteStage: 'FIRST',
    youVoted: false,
    lastVote: null,
    guessOptions: null,
    guessingPlayerId: null,
    ending: null,
    lobby: {
      code: room.code,
      names: room.seats.map((s) => s.name),
      hostName: room.seats[0]!.name,
    },
  };
}

export function projectView(room: Room, seatId: string, now: number): PlayerView | null {
  const seat = room.seats.find((s) => s.seatId === seatId);
  if (!seat) return null;
  if (room.state.phase === 'SETUP') return lobbyView(room, seatId, now);

  const you = playerIdOf(room, seatId);
  if (you === null) return null;

  const state = room.state;
  const phase = state.phase;
  const player = playerById(state, you);

  const players: ViewPlayer[] = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    connected: isConnected(room, p.id),
  }));

  // ── REVEAL ────────────────────────────────────────────────────────────────
  // The single field that legitimately differs by role, and it goes only to
  // the player it belongs to. In HIDDEN mode `getRevealView` returns
  // `kind: 'PLAIN'` for everyone, so even this one carries no tell.
  const reveal = phase === 'REVEAL' ? getRevealView(state, you) : null;

  // ── CLUES ─────────────────────────────────────────────────────────────────
  const currentPlayerId = phase === 'CLUES' ? (state.turnOrder[state.clueTurnIndex] ?? null) : null;
  // Typed clues are secret until the whole round is in — that is the point of
  // the mode. `state.clues` is cleared at the start of every round anyway, so
  // from DISCUSSION on it holds exactly this round's board.
  const clues = phase === 'CLUES' ? null : state.clues;

  // ── VOTING ────────────────────────────────────────────────────────────────
  const voteTargets = phase === 'VOTING' && player.alive ? voteTargetsFor(state, you) : [];

  // ── IMPOSTER_GUESS ────────────────────────────────────────────────────────
  // Four ids, one of which is the secret word. Handing that set to a bystander
  // would narrow the answer to one in four, so only the guesser gets it.
  const isGuesser = phase === 'IMPOSTER_GUESS' && state.guessingImposterId === you;
  const guessOptions: GuessOption[] | null =
    isGuesser && state.guessOptions
      ? state.guessOptions.map((id) => ({ id, word: getWordEntry(id).word }))
      : null;

  // ── GAME_OVER ─────────────────────────────────────────────────────────────
  const entry = phase === 'GAME_OVER' ? getSecretEntry(state) : null;
  const ending: Ending | null =
    phase === 'GAME_OVER' && entry
      ? {
          secretWord: entry.word,
          hintWord: state.hintWord ?? '',
          hintKind: state.hintKind ?? 'SIBLING',
          category: entry.category,
          imposterIds: state.imposterIds,
          guessResult: state.guessResult,
          winner: state.winner,
        }
      : null;

  // ── waiting ───────────────────────────────────────────────────────────────
  const kind = waitingKind(state);
  let waiting: Waiting | null = null;
  if (kind !== null) {
    const voters = electorate(state, kind);
    const done = pendingSetFor(room, kind);
    waiting = {
      kind,
      done: done.length,
      needed: neededFor(state, kind),
      total: voters.length,
      youDone: done.includes(you),
      // Named only where knowing who we're waiting for is useful and harmless.
      // A vote in progress must stay anonymous: naming who has already voted
      // tells the room who is deliberating.
      names:
        kind === 'VOTE'
          ? []
          : state.players
              .filter((p) => voters.includes(p.id) && !done.includes(p.id))
              .map((p) => p.name),
    };
  }

  return {
    v: room.version,
    key: String(room.epoch),
    you: { id: you, name: player.name, isHost: seat.isHost, alive: player.alive },
    phase,
    roundNumber: state.roundNumber,
    settings: state.settings,
    players,

    waiting,
    deadlineAt: room.deadlineAt,
    serverNow: now,

    reveal,

    turnOrder: state.turnOrder,
    discussionOrder: state.discussionOrder,
    currentPlayerId,
    isYourTurn: currentPlayerId === you,
    clues,

    yourChoice: room.pending.choice[you] ?? null,
    choiceTally: choiceTally(room),

    voteTargets,
    voteStage: state.voteStage,
    youVoted: room.pending.votes[you] !== undefined,

    lastVote: phase === 'VOTE_RESULT' ? state.lastVote : null,

    guessOptions,
    guessingPlayerId: phase === 'IMPOSTER_GUESS' ? state.guessingImposterId : null,

    ending,
    lobby: null,
  };
}

/** Convenience for the host, which always projects its own seat. */
export function projectForPlayer(
  room: Room,
  playerId: PlayerId,
  now: number,
): PlayerView | null {
  const seatId = seatIdOf(room, playerId);
  return seatId === null ? null : projectView(room, seatId, now);
}
