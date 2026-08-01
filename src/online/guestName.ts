/**
 * Who a guest says they are, and who the host says they are.
 *
 * Three values that look like one, which is exactly why this kept going wrong
 * when the logic was four scattered conditions inside `useGuest`:
 *
 *  • **intended** — the name this device wants to be known by. The name typed
 *    on the join screen, then whatever the last rename asked for.
 *  • **authoritative** — the name the host actually has us down as, which
 *    arrives on every `VIEW` as `view.you.name`. This is the only one that is
 *    true. A rename can be refused (the name is taken, or the roster is already
 *    frozen), and the host ignores the name in a reconnecting `JOIN` by design.
 *  • **persisted** — what is in the session, which is what the *next* reconnect
 *    will introduce itself as.
 *
 * The two bugs these functions exist to make impossible:
 *
 *  1. Persisting `intended` instead of `authoritative`, so a refused rename was
 *     re-sent by every reconnect for the rest of the evening.
 *  2. Deciding whether to persist by comparing against `intended`, which is
 *     equal to `authoritative` in precisely the case that needs writing — an
 *     accepted rename — so the write never happened at all.
 */

/**
 * What to write to the session, or null to leave it alone.
 *
 * Compared against what was last written rather than against what we wanted,
 * so an accepted rename is caught and a `VIEW` that changed nothing is not —
 * `VIEW` arrives on every version bump, and a `localStorage` write per message
 * is not something to do by accident.
 */
export function nameToPersist(
  authoritative: string,
  persisted: string | null,
): string | null {
  return authoritative === persisted ? null : authoritative;
}

/**
 * Should we ask to be renamed on arrival, and to what?
 *
 * A player who left and came back typing something new means it — but a `JOIN`
 * that names a seat deliberately ignores the name it carries, because on an
 * ordinary reconnect that name is stale by construction. So the request has to
 * be made again, separately, as a rename.
 *
 * Only in the lobby. Mid-game the host refuses every rename (the roster is
 * frozen into `state.players`), and asking anyway painted "הפעולה לא אפשרית
 * כרגע" across the screen of a player who had just reconnected and asked for
 * nothing. That is why this is decided from a `VIEW` — which knows the phase —
 * and not from `WELCOME`, which does not.
 */
export function renameOnArrival(
  intended: string,
  authoritative: string,
  inLobby: boolean,
): string | null {
  if (!inLobby) return null;
  return intended === authoritative ? null : intended;
}
