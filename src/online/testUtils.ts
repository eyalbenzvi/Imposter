/**
 * Test-only helpers for driving a `Room` the way the network layer would.
 * Everything here is synchronous and pure — no React, no PeerJS, no clock.
 */

import { names } from '../game/testUtils';
import { currentCluePlayer } from '../game/rules';
import type { PlayerId, Settings } from '../game/types';
import { handleIntent, hostCommand, startGame, type Env, type Outcome } from './driver';
import {
  PROTOCOL_VERSION,
  type GuestMessage,
  type HostCommand,
  type Intent,
} from './protocol';
import { handleJoin } from './driver';
import { createRoom, playerIdOf, seatIdOf, type Room } from './room';

export const SEED = 'seed-online';

export function env(seed = SEED, now = 1_700_000_000_000): Env {
  return { seed, now };
}

/** A lobby with `count` seats: the host plus `count - 1` guests. */
export function lobby(count = 5, settings: Partial<Settings> = {}): Room {
  const roster = names(count);
  let room = createRoom('1234', roster[0]!, settings);
  for (let i = 1; i < count; i++) {
    const out = handleJoin(room, `c${i}`, {
      t: 'JOIN',
      v: PROTOCOL_VERSION,
      name: roster[i]!,
    });
    if (!out.accepted) throw new Error(`join ${i} rejected: ${out.reason}`);
    room = out.room;
  }
  return room;
}

export function expectOk(outcome: Outcome): Room {
  if (!outcome.accepted) {
    throw new Error(`expected accepted, got ${outcome.reason}`);
  }
  return outcome.room;
}

/** Send an intent as a player id, minting the correct key automatically. */
export function asPlayer(
  room: Room,
  playerId: PlayerId,
  msg: Intent,
  e: Env = env(),
): Outcome {
  const seatId = seatIdOf(room, playerId);
  if (seatId === null) throw new Error(`no seat for ${playerId}`);
  return handleIntent(room, seatId, { ...msg, key: String(room.epoch) } as GuestMessage, e);
}

export function host(room: Room, cmd: HostCommand, e: Env = env()): Outcome {
  return hostCommand(room, cmd, e);
}

/** Lobby → a game sitting in REVEAL. */
export function started(count = 5, settings: Partial<Settings> = {}, e: Env = env()): Room {
  return expectOk(startGame(lobby(count, settings), e));
}

/** Everybody acknowledges their word; the room lands in CLUES. */
export function revealed(room: Room, e: Env = env()): Room {
  let next = room;
  for (const player of next.state.players) {
    next = expectOk(asPlayer(next, player.id, { t: 'READY' }, e));
  }
  return next;
}

/** A whole SPEAK clue round, straight through to DISCUSSION. */
export function speakRound(room: Room, e: Env = env()): Room {
  let next = room;
  let guard = 0;
  while (next.state.phase === 'CLUES') {
    if (guard++ > 32) throw new Error('speakRound did not terminate');
    const current = currentCluePlayer(next.state);
    if (current === null) break;
    next = expectOk(asPlayer(next, current, { t: 'NEXT_TURN' }, e));
  }
  return next;
}

/** A whole TYPE clue round. */
export function typeRound(room: Room, e: Env = env()): Room {
  let next = room;
  let guard = 0;
  while (next.state.phase === 'CLUES') {
    if (guard++ > 32) throw new Error('typeRound did not terminate');
    const current = currentCluePlayer(next.state);
    if (current === null) break;
    next = expectOk(asPlayer(next, current, { t: 'CLUE', text: `רמז${guard}` }, e));
  }
  return next;
}

/** Everyone alive chooses to move on; the room lands in VOTING. */
export function toVoting(room: Room, e: Env = env()): Room {
  let next = room;
  for (const player of next.state.players.filter((p) => p.alive)) {
    if (next.state.phase !== 'DISCUSSION') break;
    next = expectOk(asPlayer(next, player.id, { t: 'CHOOSE', option: 'VOTE' }, e));
  }
  return next;
}

/**
 * Everybody votes for `target`; `target` votes for the first other option.
 * Mirrors `game/testUtils.castAll`, but through the online driver.
 */
export function voteOut(room: Room, target: PlayerId, e: Env = env()): Room {
  let next = room;
  const alive = next.state.players.filter((p) => p.alive).map((p) => p.id);
  for (const voter of alive) {
    if (next.state.phase !== 'VOTING') break;
    const options = next.state.eligibleTargets.filter((id) => id !== voter);
    const pick = voter === target ? options[0]! : target;
    next = expectOk(asPlayer(next, voter, { t: 'VOTE', target: pick }, e));
  }
  return next;
}

/** Everyone taps ready on a result screen. */
export function allReady(room: Room, e: Env = env()): Room {
  let next = room;
  const phase = next.state.phase;
  for (const player of next.state.players) {
    if (next.state.phase !== phase) break;
    next = expectOk(asPlayer(next, player.id, { t: 'READY' }, e));
  }
  return next;
}

export function imposter(room: Room): PlayerId {
  const id = room.state.imposterIds[0];
  if (!id) throw new Error('no imposter dealt');
  return id;
}

export function citizen(room: Room): PlayerId {
  const p = room.state.players.find((x) => !x.isImposter);
  if (!p) throw new Error('no citizen');
  return p.id;
}

export { playerIdOf, seatIdOf };
