import { describe, expect, it } from 'vitest';
import { nameToPersist, renameOnArrival } from './guestName';

/**
 * Two functions, four lines, and both of them were wrong the first time inside
 * `useGuest` — which is exactly the argument for pulling them out here.
 */
describe('what to persist', () => {
  it('writes the host’s name the first time it differs from what is stored', () => {
    expect(nameToPersist('רוני', 'רון')).toBe('רוני');
    expect(nameToPersist('רוני', null)).toBe('רוני');
  });

  /**
   * A `VIEW` arrives on every version bump — every vote, every tick of a live
   * counter. Writing on each one would put a `localStorage` write in the path
   * of every message on the wire.
   */
  it('writes nothing when the stored name is already right', () => {
    expect(nameToPersist('רוני', 'רוני')).toBeNull();
  });

  /**
   * The bug this replaced: the guard compared against the *intended* name,
   * which an accepted rename has already been set to. So the two were equal in
   * precisely the case that needed writing, the write never happened, and the
   * session kept the pre-rename name — which the next reconnect then re-sent
   * as a rename, for the rest of the evening.
   */
  it('writes an accepted rename, which the old intended-name guard skipped', () => {
    const intended = 'רוני';
    const authoritative = 'רוני'; // the host said yes
    const persisted = 'רון'; // still the old one
    expect(authoritative).toBe(intended); // the guard that used to fail
    expect(nameToPersist(authoritative, persisted)).toBe('רוני');
  });

  it('writes the old name back when the host refused the rename', () => {
    // The host still has us as 'רון'; we asked for a name already taken.
    expect(nameToPersist('רון', 'רוני')).toBe('רון');
  });

  /**
   * The host stores `normalize(name.trim())`, so what comes back can be a
   * different string from what was asked for and still be an acceptance. What
   * gets written is always the host's version, never ours.
   */
  it('writes the host’s spelling, not the one that was asked for', () => {
    const asked = 'רוניְ'; // with a combining mark the host may reorder
    const authoritative = 'רוני';
    expect(nameToPersist(authoritative, asked)).toBe(authoritative);
  });
});

describe('asking to be renamed on arrival', () => {
  it('asks when the player came back and typed something new', () => {
    expect(renameOnArrival('רוני', 'רון', true)).toBe('רוני');
  });

  it('asks for nothing when the host already agrees', () => {
    expect(renameOnArrival('רון', 'רון', true)).toBeNull();
  });

  /**
   * Mid-game the roster is frozen into `state.players` and the host refuses
   * every rename with `NOT_ALLOWED` — which painted a red banner across the
   * screen of a player who had just reconnected and asked for nothing at all.
   */
  it('asks for nothing once the game has started', () => {
    expect(renameOnArrival('רוני', 'רון', false)).toBeNull();
  });
});
