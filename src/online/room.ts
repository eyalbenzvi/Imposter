/**
 * What the host device holds. Everything here is plain data — no React, no
 * network, no clock — so `driver.ts` can be a set of pure functions over it and
 * the whole online rulebook is testable in Node.
 *
 * `Room` is NOT `GameState`. It wraps one, and adds the things the reducer
 * deliberately knows nothing about: who is connected, which intents have
 * arrived but not yet been applied, and the two counters that keep the guests
 * in step.
 */

import { createInitialState, DEFAULT_SETTINGS } from '../game/reducer';
import { nameKey } from '../game/rules';
import { MAX_PLAYERS, type GameState, type PlayerId, type Settings } from '../game/types';
// `protocol.ts` has no runtime imports of its own (everything it pulls in is
// `import type`), so taking a value from it here does not create a cycle.
import { MAX_NAME_LENGTH, type ChoiceOption, type SeatId } from './protocol';

export type Seat = {
  seatId: SeatId;
  name: string;
  /** The live data channel, or null while this player is disconnected. */
  connId: string | null;
  isHost: boolean;
};

/**
 * Intents that have arrived but are not yet a game action.
 *
 * This is the buffer that lets everybody vote at once against a reducer that
 * insists on one voter at a time: the votes sit here until the last one lands,
 * then the driver replays them in `voterOrder`.
 *
 * Keyed by `PlayerId`, not `SeatId` — everything in here is about the game, and
 * player ids are what the reducer speaks.
 */
export type Pending = {
  reveal: PlayerId[];
  ready: PlayerId[];
  choice: Record<PlayerId, ChoiceOption>;
  votes: Record<PlayerId, PlayerId>;
};

export type Room = {
  code: string;
  seats: Seat[];
  /**
   * Frozen when the game starts: position i holds the seat that became `p{i}`.
   *
   * This is the ONLY source of truth for seat↔player identity. Deriving it from
   * the live `seats` array would be a disaster — after a host refresh the
   * guests reconnect in whatever order their backoff timers fire, and a
   * reconnection-ordered map hands players each other's reveal cards.
   */
  seatOrder: SeatId[] | null;
  /** Set at START_GAME. A locked room turns away new joiners. */
  locked: boolean;
  /** Chosen in the lobby, before there is a reducer state to hold them. */
  settings: Settings;
  state: GameState;
  pending: Pending;
  /**
   * Bumped only when actions are applied to `state`. This is the sync key: an
   * intent minted against an older epoch is stale and gets rejected.
   *
   * Deliberately NOT derived from state fields — `NEW_ROUND` resets phase,
   * roundNumber, clueTurnIndex and voterIndex all at once, so a field-derived
   * key repeats across games and would accept an intent from the previous one.
   */
  epoch: number;
  /**
   * Bumped on *any* change, including intents that only land in `pending`.
   * Drives re-render and broadcast, so the live "4 / 6 voted" counters move
   * while the game state stands still.
   */
  version: number;
  /** Epoch-ms deadline on the host's clock, or null when no timer is set. */
  deadlineAt: number | null;
};

export function emptyPending(): Pending {
  return { reveal: [], ready: [], choice: {}, votes: {} };
}

export function createRoom(
  code: string,
  hostName: string,
  settings: Partial<Settings> = {},
): Room {
  return {
    code,
    seats: [{ seatId: 's0', name: hostName, connId: 'host', isHost: true }],
    seatOrder: null,
    locked: false,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    state: createInitialState(),
    pending: emptyPending(),
    epoch: 1,
    version: 1,
    deadlineAt: null,
  };
}

export function seatById(room: Room, seatId: SeatId): Seat | undefined {
  return room.seats.find((s) => s.seatId === seatId);
}

export function seatByConn(room: Room, connId: string): Seat | undefined {
  return room.seats.find((s) => s.connId === connId);
}

/**
 * Seat → player id, derived only from the frozen order.
 *
 * Before the game starts there are no player ids at all, which is why this
 * returns null rather than guessing from the seat index.
 */
export function playerIdOf(room: Room, seatId: SeatId): PlayerId | null {
  if (!room.seatOrder) return null;
  const index = room.seatOrder.indexOf(seatId);
  return index === -1 ? null : `p${index}`;
}

export function seatIdOf(room: Room, playerId: PlayerId): SeatId | null {
  if (!room.seatOrder) return null;
  const index = Number(playerId.slice(1));
  return room.seatOrder[index] ?? null;
}

/**
 * The invariant that keeps identity honest. If this ever fails the room is
 * unsafe to broadcast: some player would be handed another player's word.
 */
export function seatOrderIsSound(room: Room): boolean {
  if (!room.seatOrder) return room.state.phase === 'SETUP';
  if (room.seatOrder.length !== room.state.players.length) return false;
  return room.seatOrder.every((seatId) => seatById(room, seatId) !== undefined);
}

/** Whether a player's device is currently attached. */
export function isConnected(room: Room, playerId: PlayerId): boolean {
  const seatId = seatIdOf(room, playerId);
  if (seatId === null) return false;
  return seatById(room, seatId)?.connId !== null;
}

// ── lobby validation ─────────────────────────────────────────────────────────

export type JoinRejection =
  | 'NAME_EMPTY'
  | 'NAME_LONG'
  | 'NAME_TAKEN'
  | 'ROOM_FULL'
  | 'ROOM_LOCKED';

/**
 * The lobby's gate, deliberately built from the same helpers the reducer's own
 * gate uses.
 *
 * `START_GAME` throws on duplicate names, and it compares them through
 * `nameKey` — trimmed, whitespace-collapsed, niqqud stripped. A naive `===`
 * here would admit "דָּנָה" alongside "דנה", and the room would then be
 * unstartable with no way out: the throw happens inside the reducer, long after
 * everybody has joined.
 */
export function validateJoin(
  room: Room,
  name: string,
  existingSeatId?: SeatId,
): JoinRejection | null {
  if (room.locked && existingSeatId === undefined) return 'ROOM_LOCKED';

  const key = nameKey(name);
  if (key === '') return 'NAME_EMPTY';
  if (name.trim().length > MAX_NAME_LENGTH) return 'NAME_LONG';

  const taken = room.seats.some(
    (s) => s.seatId !== existingSeatId && nameKey(s.name) === key,
  );
  if (taken) return 'NAME_TAKEN';

  if (existingSeatId === undefined && room.seats.length >= MAX_PLAYERS) {
    return 'ROOM_FULL';
  }
  return null;
}

/** A fresh seat id that can't clash with one already handed out. */
export function nextSeatId(room: Room): SeatId {
  let n = room.seats.length;
  const used = new Set(room.seats.map((s) => s.seatId));
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}
