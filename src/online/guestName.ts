/**
 * Who a guest says they are, and who the host says they are.
 *
 * Three values that look like one, which is why this kept going wrong when the
 * logic was a handful of conditions scattered through `useGuest`:
 *
 *  • **intended** — the name this device wants to be known by. What was typed
 *    on the join screen, then whatever the last rename asked for.
 *  • **authoritative** — the name the host actually has us down as, which
 *    arrives on every `VIEW` as `view.you.name`. This is the only one that is
 *    true. A rename can be refused (the name is taken, or the roster is
 *    already frozen), the host stores `normalize(name.trim())` rather than the
 *    string it was handed, and a reconnecting `JOIN` has its name ignored by
 *    design.
 *  • **persisted** — what is in the session, which is what the *next*
 *    reconnect will introduce itself as.
 *
 * The whole thing is a state machine with three inputs, so it is written as
 * one: pure, effect-free, and tested in Node. That is the same shape as
 * `retry.ts` and `brokerLoop.ts`, and for the same reason — every bug this
 * file has ever had lived in the wiring, not in the arithmetic.
 */

export type NameState = {
  intended: string;
  persisted: string | null;
  /**
   * The name we had before the rename currently in flight, or null when none
   * is. Doubles as the "is one in flight" flag.
   */
  prior: string | null;
  /** Did a human ask for the rename in flight, or did we send it for them? */
  asked: boolean;
  /** Still to decide whether to ask for a rename on arrival. */
  arriving: boolean;
};

export function initialName(intended: string, persisted: string | null): NameState {
  return { intended, persisted, prior: null, asked: false, arriving: persisted !== null };
}

/** What the caller should do, on top of taking the new state. */
export type NameEffect = {
  state: NameState;
  /** Send `RENAME` with this name. */
  rename?: string;
  /** Write this name to the session. */
  persist?: string;
};

/**
 * A `VIEW` arrived. The host's name for us is in it, and it settles everything.
 */
export function onView(
  state: NameState,
  authoritative: string,
  inLobby: boolean,
): NameEffect {
  // ── first view of this connection ─────────────────────────────────────────
  if (state.arriving) {
    const next = { ...state, arriving: false };
    // Reclaiming a seat and being called something new are two separate
    // requests, and a `JOIN` naming a seat only makes the first: the name it
    // carries is ignored, because on an ordinary reconnect it is stale by
    // construction. So a player who came back and typed something else has to
    // say it again, separately.
    //
    // Lobby only. Mid-game the roster is frozen into `state.players` and the
    // host refuses every rename — and asking anyway painted "הפעולה לא אפשרית
    // כרגע" across the screen of somebody who had just reconnected and asked
    // for nothing at all.
    if (inLobby && state.intended !== authoritative) {
      return {
        state: { ...next, prior: authoritative, asked: false },
        rename: state.intended,
      };
    }
    return settle({ ...next, prior: null }, authoritative);
  }

  // ── a rename is in flight ─────────────────────────────────────────────────
  if (state.prior !== null) {
    // A view still carrying the *old* name is an unrelated broadcast that
    // raced past the request; adopting it would roll the name backwards
    // mid-flight. Anything else settles it — deliberately not "the exact name
    // we asked for", because the host normalises and so an acceptance can come
    // back as a different string.
    if (authoritative === state.prior) return { state };
    return settle({ ...state, prior: null, asked: false }, authoritative);
  }

  return settle(state, authoritative);
}

/**
 * Adopt the host's name, and write it only if the session does not already say
 * so. `VIEW` arrives on every version bump — every vote, every tick of a live
 * counter — and a `localStorage` write per message is not something to do by
 * accident.
 */
function settle(state: NameState, authoritative: string): NameEffect {
  const next = { ...state, intended: authoritative };
  if (state.persisted === authoritative) return { state: next };
  return { state: { ...next, persisted: authoritative }, persist: authoritative };
}

/** The player asked to be called something else. */
export function onRename(state: NameState, next: string): NameEffect {
  return {
    state: { ...state, intended: next, prior: state.intended, asked: true },
    rename: next,
    // Nothing is persisted here. The host may well refuse it, and a stored
    // name it never accepted would be re-sent by every reconnect from now on.
  };
}

/** A `REJECTED` for a `RENAME` came back. */
export function onRenameRefused(
  state: NameState,
  reason: string,
): { state: NameState; surface: boolean } {
  const reverted =
    state.prior !== null ? { ...state, intended: state.prior, prior: null } : state;

  // Whether to say anything turns on whether a human asked.
  //
  // A rename sent on arrival can lose a race with the host tapping "start", and
  // a red banner over the reveal screen of somebody who just reconnected is a
  // bug report, not a message. But `NOT_ALLOWED` is the *only* thing that race
  // can produce — `renameSeat` checks the lock first — so every other reason is
  // a lobby answer that is always worth reading, including one for a rename
  // that was asked for and then retried across a reconnect, which is how the
  // "did a human ask" flag gets lost.
  const surface = state.asked || reason !== 'NOT_ALLOWED';
  return { state: { ...reverted, asked: false }, surface };
}

/**
 * A connection ended. A rename that was in flight is simply lost — the host
 * either applied it or did not, and its next `VIEW` says which. Leaving the
 * flag set would freeze the persist path for good.
 */
export function onReconnect(state: NameState, persisted: string | null): NameState {
  return { ...state, persisted, prior: null, asked: false, arriving: persisted !== null };
}
