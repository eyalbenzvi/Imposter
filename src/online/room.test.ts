import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS } from '../game/types';
import {
  createRoom,
  nextSeatId,
  playerIdOf,
  seatIdOf,
  seatOrderIsSound,
  validateJoin,
} from './room';
import { lobby, revealed, speakRound, started, toVoting, voteOut } from './testUtils';

/**
 * `seatOrder` is the only thing standing between a restored session and a leak:
 * if it stops lining up with the roster, `projectView` hands somebody another
 * player's reveal card — the imposter gets the citizens' word, invisibly.
 * `useHost.broadcast` refuses to send anything when this returns false, so
 * these are the tests that keep that refusal honest.
 */
describe('seatOrderIsSound', () => {
  it('holds for a freshly started game', () => {
    expect(seatOrderIsSound(started(6))).toBe(true);
  });

  it('holds through ejections and a second round', () => {
    let room = revealed(started(6, { imposterGuessEnabled: false }));
    room = speakRound(room);
    room = toVoting(room);
    room = voteOut(room, 'p2');
    expect(seatOrderIsSound(room)).toBe(true);
  });

  it('holds in the lobby, where there is no order yet', () => {
    expect(seatOrderIsSound(lobby(4))).toBe(true);
  });

  it('fails when the order is shorter than the roster', () => {
    const room = started(5);
    expect(seatOrderIsSound({ ...room, seatOrder: room.seatOrder!.slice(0, 4) })).toBe(
      false,
    );
  });

  it('fails when the order is longer than the roster', () => {
    const room = started(5);
    expect(
      seatOrderIsSound({ ...room, seatOrder: [...room.seatOrder!, 's99'] }),
    ).toBe(false);
  });

  it('fails when the order names a seat that is no longer in the room', () => {
    const room = started(5);
    expect(
      seatOrderIsSound({ ...room, seats: room.seats.slice(0, 4) }),
    ).toBe(false);
  });

  it('fails when a started game somehow has no order at all', () => {
    const room = started(5);
    expect(seatOrderIsSound({ ...room, seatOrder: null })).toBe(false);
  });
});

describe('seat ↔ player mapping', () => {
  it('is a bijection over the frozen order', () => {
    const room = started(7);
    const seen = new Set<string>();
    for (const seat of room.seats) {
      const playerId = playerIdOf(room, seat.seatId)!;
      expect(seen.has(playerId)).toBe(false);
      seen.add(playerId);
      expect(seatIdOf(room, playerId)).toBe(seat.seatId);
    }
    expect(seen.size).toBe(room.state.players.length);
  });

  it('refuses to name an unknown seat', () => {
    const room = started(4);
    expect(playerIdOf(room, 'nope')).toBeNull();
    expect(seatIdOf(room, 'p99')).toBeNull();
  });

  /**
   * The scenario this guards: a host refreshes, and the guests reconnect in
   * whatever order their backoff timers happen to fire. Identity must come from
   * the stored order, never from who got back first.
   */
  it('survives the seats being reordered underneath it', () => {
    const room = started(5);
    const shuffled = { ...room, seats: [...room.seats].reverse() };
    expect(seatOrderIsSound(shuffled)).toBe(true);
    for (const seat of room.seats) {
      expect(playerIdOf(shuffled, seat.seatId)).toBe(playerIdOf(room, seat.seatId));
    }
  });
});

describe('validateJoin', () => {
  it('compares names the way the reducer does', () => {
    const room = createRoom('123456', 'דָּנָה');
    expect(validateJoin(room, 'דנה')).toBe('NAME_TAKEN');
    expect(validateJoin(room, ' דנה ')).toBe('NAME_TAKEN');
    expect(validateJoin(room, 'דן')).toBeNull();
  });

  it('lets a player keep their own name when reconnecting', () => {
    const room = lobby(3);
    const seat = room.seats[1]!;
    expect(validateJoin(room, seat.name)).toBe('NAME_TAKEN');
    expect(validateJoin(room, seat.name, seat.seatId)).toBeNull();
  });

  it('caps the room at MAX_PLAYERS but still admits reconnections', () => {
    const room = lobby(MAX_PLAYERS);
    expect(validateJoin(room, 'נוסף')).toBe('ROOM_FULL');
    const seat = room.seats[3]!;
    expect(validateJoin(room, seat.name, seat.seatId)).toBeNull();
  });

  it('turns away newcomers once the game has started, but not returners', () => {
    const room = started(4);
    expect(validateJoin(room, 'מאחר')).toBe('ROOM_LOCKED');
    const seat = room.seats[2]!;
    expect(validateJoin(room, seat.name, seat.seatId)).toBeNull();
  });
});

describe('nextSeatId', () => {
  it('never reuses an id that is already out there', () => {
    const room = lobby(4);
    const gap = { ...room, seats: room.seats.filter((s) => s.seatId !== 's1') };
    const fresh = nextSeatId(gap);
    expect(gap.seats.some((s) => s.seatId === fresh)).toBe(false);
  });
});
