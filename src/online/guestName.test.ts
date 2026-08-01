import { describe, expect, it } from 'vitest';
import {
  initialName,
  onReconnect,
  onRename,
  onRenameRefused,
  onView,
  type NameState,
} from './guestName';

/**
 * Every bug this file has ever had lived in the *orchestration* of these
 * values, not in any single comparison — which is why the whole machine is
 * here rather than a couple of helper predicates.
 *
 * A note on `intended` vs `authoritative`: the host stores
 * `normalize(name.trim())`, so an accepted rename can legitimately come back
 * as a different string from the one that was asked for. Several tests below
 * exist only to pin that.
 */

/** In the lobby, freshly joined, nothing stored yet. */
const fresh = (name: string): NameState => initialName(name, null);

/** Back in a room we have a session for. */
const returning = (intended: string, stored: string): NameState =>
  initialName(intended, stored);

describe('a first join', () => {
  it('adopts the host’s name and writes it', () => {
    const out = onView(fresh('רון'), 'רון', true);
    expect(out.rename).toBeUndefined();
    expect(out.persist).toBe('רון');
    expect(out.state.intended).toBe('רון');
  });

  it('takes the host’s spelling when it normalised ours', () => {
    const out = onView(fresh('רון '), 'רון', true);
    expect(out.persist).toBe('רון');
    expect(out.state.intended).toBe('רון');
  });

  /**
   * `VIEW` arrives on every version bump — every vote, every tick of a live
   * counter. A `localStorage` write per message is not something to do by
   * accident.
   */
  it('writes nothing on the views that follow', () => {
    let state = onView(fresh('רון'), 'רון', true).state;
    for (let i = 0; i < 5; i++) {
      const out = onView(state, 'רון', false);
      expect(out.persist).toBeUndefined();
      state = out.state;
    }
  });
});

describe('coming back to a room', () => {
  it('says nothing when the host already agrees', () => {
    const out = onView(returning('רון', 'רון'), 'רון', true);
    expect(out.rename).toBeUndefined();
  });

  /**
   * A `JOIN` naming a seat has its name ignored by design — on an ordinary
   * reconnect the name it carries is stale. So a player who came back and
   * typed something else has to say it again, separately.
   */
  it('asks again when the player typed something new', () => {
    const out = onView(returning('דני', 'רון'), 'רון', true);
    expect(out.rename).toBe('דני');
    expect(out.persist).toBeUndefined();
  });

  /**
   * Mid-game the roster is frozen and the host refuses every rename — and
   * asking anyway painted "הפעולה לא אפשרית כרגע" across the screen of
   * somebody who had just reconnected and asked for nothing at all.
   */
  it('asks for nothing once the game has started', () => {
    const out = onView(returning('דני', 'רון'), 'רון', false);
    expect(out.rename).toBeUndefined();
    // And it takes the host's word for who it is — with nothing to write,
    // because the session already says exactly that.
    expect(out.state.intended).toBe('רון');
    expect(out.persist).toBeUndefined();
  });

  it('corrects the session when the host disagrees with it', () => {
    // The seat was renamed by the host while this phone was away.
    const out = onView(returning('רון', 'רון'), 'רוני', false);
    expect(out.persist).toBe('רוני');
    expect(out.state.intended).toBe('רוני');
  });

  it('asks only once, not on every view after', () => {
    const first = onView(returning('דני', 'רון'), 'רון', true);
    expect(first.rename).toBe('דני');
    const second = onView(first.state, 'דני', true);
    expect(second.rename).toBeUndefined();
  });
});

describe('a rename the player asked for', () => {
  const asked = (): NameState => onRename(fresh('רון'), 'דני').state;

  it('is not written until the host has agreed', () => {
    const out = onRename(fresh('רון'), 'דני');
    expect(out.rename).toBe('דני');
    expect(out.persist).toBeUndefined();
  });

  /**
   * The bug this machine replaced: the persist guard compared against the
   * *intended* name, which an accepted rename has already been set to. The two
   * were equal in precisely the case that needed writing, so the write never
   * happened — and every later reconnect re-sent the rename, which mid-game is
   * refused and paints a banner.
   */
  it('is written once the host confirms it', () => {
    const out = onView(asked(), 'דני', true);
    expect(out.persist).toBe('דני');
    expect(out.state.intended).toBe('דני');
    expect(out.state.prior).toBeNull();
  });

  it('is not rolled back by a broadcast that raced past it', () => {
    // Somebody else's action bumps the version before our rename is processed.
    const out = onView(asked(), 'רון', true);
    expect(out.persist).toBeUndefined();
    expect(out.state.intended).toBe('דני');
    expect(out.state.prior).toBe('רון');
    // …and the real answer still settles it.
    const then = onView(out.state, 'דני', true);
    expect(then.persist).toBe('דני');
  });

  /**
   * The host normalises, so an acceptance can arrive as a third string.
   * Requiring an exact match left the in-flight flag set for good: the session
   * stopped being updated and every reconnect re-sent a stale rename.
   */
  it('settles on whatever the host actually stored', () => {
    const out = onView(asked(), 'דני!', true);
    expect(out.state.prior).toBeNull();
    expect(out.state.intended).toBe('דני!');
    expect(out.persist).toBe('דני!');
  });

  it('reverts, and is worth saying out loud, when it is refused', () => {
    const out = onRenameRefused(asked(), 'NAME_TAKEN');
    expect(out.state.intended).toBe('רון');
    expect(out.surface).toBe(true);
  });
});

describe('a rename nobody asked for', () => {
  /** The one sent on arrival, when the player re-entered with a new name. */
  const onArrival = (): NameState => onView(returning('דני', 'רון'), 'רון', true).state;

  /**
   * The host can lock the room in the gap between sending the view we decided
   * from and this arriving. A red banner over the reveal screen of somebody
   * who just reconnected is a bug report, not a message.
   */
  it('is refused silently when the room locked underneath it', () => {
    const out = onRenameRefused(onArrival(), 'NOT_ALLOWED');
    expect(out.surface).toBe(false);
    expect(out.state.intended).toBe('רון');
  });

  /**
   * But `NOT_ALLOWED` is the *only* thing that race can produce — `renameSeat`
   * checks the lock first. Every other reason is a lobby answer the player
   * needs, including for a rename they did ask for and that was retried across
   * a reconnect, which is how the "a human asked" flag gets lost.
   */
  it('is still reported when the reason is one only the lobby can give', () => {
    expect(onRenameRefused(onArrival(), 'NAME_TAKEN').surface).toBe(true);
    expect(onRenameRefused(onArrival(), 'NAME_LONG').surface).toBe(true);
  });
});

describe('across a reconnect', () => {
  it('forgets a rename that was in flight, and re-reads the session', () => {
    const state = onRename(fresh('רון'), 'דני').state;
    const next = onReconnect(state, 'רון');
    expect(next.prior).toBeNull();
    expect(next.asked).toBe(false);
    expect(next.persisted).toBe('רון');
    // Still wanting to be 'דני', so it asks again on arrival.
    expect(onView(next, 'רון', true).rename).toBe('דני');
  });

  it('does not ask for anything when there is no session to come back to', () => {
    const next = onReconnect(fresh('רון'), null);
    expect(next.arriving).toBe(false);
    expect(onView(next, 'רון', true).rename).toBeUndefined();
  });

  /**
   * A prop change is the player typing a name on the join screen and entering
   * the room again, which outranks anything remembered — but the session is
   * still the session, so a reclaim still knows what it is coming back to.
   */
  it('keeps the stored name when the player re-enters with a new one', () => {
    const state = initialName('רון', null);
    const settled = onView(state, 'רון', true).state;
    const reentered = initialName('דני', settled.persisted);
    expect(reentered.persisted).toBe('רון');
    expect(onView(reentered, 'רון', true).rename).toBe('דני');
  });
});
