import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS } from '../game/types';
import {
  createRoom,
  nextSeatId,
  playerIdOf,
  seatIdOf,
  seatOrderIsSound,
  staleConnIds,
  validateJoin,
} from './room';
import { dropConnection } from './driver';
import { lobby, revealed, speakRound, started, toVoting, voteOut } from './testUtils';

/**
 * A data channel does not reliably report that the far side is gone: a killed
 * tab, a locked phone or a dropped wifi produce no close event here at all.
 * Removal used to depend entirely on that event, which is why it worked for
 * anyone who left by tapping a button and failed for everybody else.
 */
describe('noticing that somebody has gone quiet', () => {
  const NOW = 1_000_000;
  const TIMEOUT = 10_000;

  it('names a connection that has stopped talking', () => {
    const seen = new Map([
      ['c1', NOW - 1_000],
      ['c2', NOW - 30_000],
    ]);
    expect(staleConnIds(seen.keys(), seen, NOW, TIMEOUT)).toEqual(['c2']);
  });

  /**
   * The window between a channel opening and its first message is the one time
   * "no sighting" is normal — the caller stamps one on open. Reaping then would
   * drop players as they arrive.
   */
  it('leaves a connection alone until it has been seen at least once', () => {
    expect(staleConnIds(['c1', 'c2'], new Map(), NOW, TIMEOUT)).toEqual([]);
  });

  it('reaps a channel that holds no seat at all', () => {
    // A guest refused entry, or one whose seat was taken over by a reconnect.
    // Walking the seat list could never see either, and they accumulated.
    const seen = new Map([['orphan', NOW - 60_000]]);
    expect(staleConnIds(seen.keys(), seen, NOW, TIMEOUT)).toEqual(['orphan']);
  });

  it('is exactly at the boundary, not around it', () => {
    const seen = new Map([['c1', NOW - TIMEOUT]]);
    expect(staleConnIds(seen.keys(), seen, NOW, TIMEOUT)).toEqual([]);
    expect(staleConnIds(seen.keys(), seen, NOW + 1, TIMEOUT)).toEqual(['c1']);
  });
});

describe('what a disconnect does, before and after the game starts', () => {
  /** In the lobby a departure is just a departure — no ghosts on the roster. */
  it('removes the seat entirely when somebody actually leaves an open room', () => {
    const room = lobby(4);
    const gone = room.seats[2]!;
    const after = dropConnection(room, gone.connId!, 'LEFT');
    expect(after.seats).toHaveLength(3);
    expect(after.seats.some((s) => s.seatId === gone.seatId)).toBe(false);
    expect(after.version).toBeGreaterThan(room.version);
  });

  /**
   * Silence is not a departure, and treating it as one was how a player who
   * glanced at a notification vanished from the lobby with no trace.
   *
   * A backgrounded phone stops sending heartbeats for ten seconds and then
   * comes back. Deleting the seat left nothing on the host's screen to say
   * anybody was missing — not greyed out, not "מנותק", gone — so nothing told
   * the host to wait, and starting the game in that window met the returning
   * player with `ROOM_LOCKED`, which is terminal.
   */
  it('only marks the seat absent when a lobby player merely went quiet', () => {
    const room = lobby(4);
    const quiet = room.seats[2]!;
    const after = dropConnection(room, quiet.connId!);
    expect(after.seats).toHaveLength(4);
    expect(after.seats[2]!.connId).toBeNull();
    // And the seat keeps its token, so the phone can reclaim it on return.
    expect(after.seats[2]!.token).toBe(quiet.token);
  });

  /**
   * Once the game is running the seat has a player id frozen against it, so it
   * has to stay — it is only marked absent, and the player can come back to it.
   */
  it('only marks the seat absent once the game has started', () => {
    const room = started(5);
    const gone = room.seats[3]!;
    const after = dropConnection(room, gone.connId!);
    expect(after.seats).toHaveLength(5);
    expect(after.seats[3]!.connId).toBeNull();
    expect(seatOrderIsSound(after)).toBe(true);
    expect(playerIdOf(after, gone.seatId)).toBe('p3');
  });

  it('keeps the host seated whatever happens to its channel', () => {
    const room = lobby(3);
    // `'host'` is a string a guest can name its own connection, so this must
    // not reach the host's seat by either reason.
    for (const why of ['LEFT', 'SILENT'] as const) {
      const after = dropConnection(room, 'host', why);
      expect(after.seats[0]!.isHost).toBe(true);
      expect(after.seats[0]!.connId).toBe('host');
      expect(after.seats).toHaveLength(3);
    }
  });

  it('does nothing for a connection that holds no seat', () => {
    const room = lobby(3);
    // A channel that was already replaced by a reconnect lands here.
    expect(dropConnection(room, 'ghost-channel')).toBe(room);
  });
});

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
