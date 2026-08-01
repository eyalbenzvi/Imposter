/**
 * The wire format between the host device and the guests.
 *
 * Two rules govern everything here:
 *
 *  1. Guests send *intents*, never actions. "I want to vote for p3" is not
 *     `CAST_VOTE` — the host decides when and in what order the reducer sees
 *     it. That is what lets simultaneous voting run against a reducer that
 *     insists on a strict turn order, without touching `src/game/`.
 *  2. The host sends *projections*, never state. A raw `GameState` carries the
 *     imposter's identity and the secret word; it must never reach the wire.
 */

import type { PlayerId } from '../game/types';
import type { PlayerView } from './view';

export const PROTOCOL_VERSION = 1;

/** Namespaced so a room code can't collide with another app on the broker. */
export const PEER_PREFIX = 'imposter-v1-';

/** Digits in a room code. See `randomCode` for why it is not four. */
export const ROOM_CODE_LENGTH = 6;

/** Same limits the single-device screens enforce, so both modes agree. */
export const MAX_NAME_LENGTH = 14;
export const MAX_CLUE_LENGTH = 22;

export type SeatId = string;

export type ChoiceOption = 'VOTE' | 'ANOTHER_ROUND';

/**
 * Everything a guest can say.
 *
 * `key` is the host's `epoch` as of the view the guest was looking at. The host
 * rejects any intent whose key has moved on, which is what makes late taps,
 * double taps and messages buffered across a phase change harmless.
 */
export type GuestMessage =
  /**
   * `seatId` + `token` together mean "I am coming back to that seat"; the id
   * alone means nothing, because it is guessable and the token is not. Both are
   * absent on a first join.
   */
  | { t: 'JOIN'; v: number; name: string; seatId?: SeatId; token?: string }
  | { t: 'LEAVE' }
  /** Heartbeat. Carries nothing; arriving at all is the whole message. */
  | { t: 'PING' }
  /**
   * Change my display name. Lobby only, and deliberately without a sync key:
   * two players renaming in the same tick would otherwise reject each other
   * for no reason at all.
   */
  | { t: 'RENAME'; name: string }
  | { t: 'READY'; key: string }
  | { t: 'CHOOSE'; key: string; option: ChoiceOption }
  | { t: 'VOTE'; key: string; target: PlayerId }
  | { t: 'CLUE'; key: string; text: string }
  | { t: 'NEXT_TURN'; key: string }
  | { t: 'SKIP_CLUES'; key: string }
  | { t: 'GUESS'; key: string; wordId: string };

export type GuestMessageType = GuestMessage['t'];

/**
 * An intent without its sync key — what a screen hands to `send`, which fills
 * the key in from the view it was rendered from.
 *
 * The `T extends unknown` is not noise: a plain `Omit<Union, 'key'>` collapses
 * the union down to the fields every member shares, which is just `{ t }`, and
 * every payload silently disappears.
 */
export type Intent =
  Extract<GuestMessage, { key: string }> extends infer T
    ? T extends unknown
      ? Omit<T, 'key'>
      : never
    : never;

export type HostMessage =
  /** The seat, and the secret that lets this device come back to it. */
  | { t: 'WELCOME'; v: number; seatId: SeatId; token: string }
  | { t: 'PING' }
  | { t: 'VIEW'; view: PlayerView }
  | {
      t: 'REJECTED';
      reason: RejectReason;
      /** Echoed so the guest can tell which tap was refused. */
      key: string | null;
      on: GuestMessageType;
    }
  | { t: 'CLOSED'; reason: 'HOST_LEFT' };

export type RejectReason =
  | 'NAME_TAKEN'
  | 'NAME_EMPTY'
  | 'NAME_LONG'
  | 'ROOM_FULL'
  | 'ROOM_LOCKED'
  | 'BAD_VERSION'
  | 'NOT_ALLOWED'
  | 'STALE'
  | 'BAD_PAYLOAD'
  /**
   * Somebody else reconnected to this seat, and took it.
   *
   * Terminal on purpose. A seat is taken over rather than defended (see
   * `handleJoin`), which means whenever two channels claim one seat, one of
   * them has to stop — and if the loser retries, it takes the seat straight
   * back and the two spend the evening evicting each other, one second apart,
   * with both screens flickering. Whoever arrived first stands down.
   */
  | 'SEAT_TAKEN';

/**
 * What the host can do to unstick a room — see `driver.hostCommand`.
 *
 * Every one of these is reachable from `HostStrip`. A recovery path no UI can
 * invoke is worse than none: it reads as covered, and the tests that exercise
 * it stay green while the room is wedged.
 */
export type HostCommand =
  | { t: 'FORCE_REVEAL' }
  /** Back to the lobby after a game: settings reopen, latecomers can join. */
  | { t: 'REOPEN' }
  /** The host renaming themselves — `act` goes through the intent gate. */
  | { t: 'RENAME_SEAT'; seatId: SeatId; name: string }
  | { t: 'SKIP_TURN' }
  | { t: 'FORCE_CHOICE'; option: ChoiceOption }
  | { t: 'DROP_SEAT'; seatId: SeatId }
  | { t: 'FORCE_ADVANCE' };

/**
 * How often each side says "still here", and how long silence has to last
 * before the other side believes it.
 *
 * A data channel does not reliably tell you the peer has gone. A closed tab, a
 * locked phone or a dropped wifi produce no `close` event at all on the far
 * side — sometimes ICE notices minutes later, sometimes never. Without this,
 * whether a player vanished from the lobby came down to whether they happened
 * to leave gracefully.
 */
export const HEARTBEAT_MS = 3_000;
export const SILENCE_TIMEOUT_MS = 10_000;

const GUEST_TYPES: ReadonlySet<string> = new Set<GuestMessageType>([
  'JOIN',
  'LEAVE',
  'PING',
  'RENAME',
  'READY',
  'CHOOSE',
  'VOTE',
  'CLUE',
  'NEXT_TURN',
  'SKIP_CLUES',
  'GUESS',
]);

/**
 * Anything arriving off a data channel is untrusted: a stale build, a
 * half-written JSON blob, or somebody poking at the console. Everything the
 * host acts on goes through here first.
 */
export function parseGuestMessage(raw: unknown): GuestMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  if (typeof msg.t !== 'string' || !GUEST_TYPES.has(msg.t)) return null;

  const str = (v: unknown): v is string => typeof v === 'string';

  switch (msg.t) {
    case 'JOIN':
      if (typeof msg.v !== 'number' || !str(msg.name)) return null;
      if (msg.seatId !== undefined && !str(msg.seatId)) return null;
      if (msg.token !== undefined && !str(msg.token)) return null;
      return {
        t: 'JOIN',
        v: msg.v,
        name: msg.name,
        ...(str(msg.seatId) ? { seatId: msg.seatId } : {}),
        ...(str(msg.token) ? { token: msg.token } : {}),
      };
    case 'LEAVE':
      return { t: 'LEAVE' };
    case 'PING':
      return { t: 'PING' };
    case 'RENAME':
      return str(msg.name) ? { t: 'RENAME', name: msg.name } : null;
    case 'READY':
    case 'NEXT_TURN':
    case 'SKIP_CLUES':
      return str(msg.key) ? ({ t: msg.t, key: msg.key } as GuestMessage) : null;
    case 'CHOOSE':
      if (!str(msg.key)) return null;
      if (msg.option !== 'VOTE' && msg.option !== 'ANOTHER_ROUND') return null;
      return { t: 'CHOOSE', key: msg.key, option: msg.option };
    case 'VOTE':
      return str(msg.key) && str(msg.target)
        ? { t: 'VOTE', key: msg.key, target: msg.target }
        : null;
    case 'CLUE':
      return str(msg.key) && str(msg.text)
        ? { t: 'CLUE', key: msg.key, text: msg.text }
        : null;
    case 'GUESS':
      return str(msg.key) && str(msg.wordId)
        ? { t: 'GUESS', key: msg.key, wordId: msg.wordId }
        : null;
    default:
      return null;
  }
}

export function parseHostMessage(raw: unknown): HostMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  switch (msg.t) {
    case 'WELCOME':
      return typeof msg.v === 'number' &&
        typeof msg.seatId === 'string' &&
        typeof msg.token === 'string'
        ? { t: 'WELCOME', v: msg.v, seatId: msg.seatId, token: msg.token }
        : null;
    case 'VIEW':
      return typeof msg.view === 'object' && msg.view !== null
        ? { t: 'VIEW', view: msg.view as PlayerView }
        : null;
    case 'REJECTED':
      // Checked against the real set rather than cast. A host on a newer build
      // can name a reason this one has never heard of, and an unchecked cast
      // put it straight into `REJECT_TEXT[reason]` — undefined — so the player
      // got a refusal screen with no text on it at all.
      return typeof msg.reason === 'string' &&
        msg.reason in REJECT_TEXT &&
        typeof msg.on === 'string' &&
        GUEST_TYPES.has(msg.on)
        ? {
            t: 'REJECTED',
            reason: msg.reason as RejectReason,
            key: typeof msg.key === 'string' ? msg.key : null,
            on: msg.on as GuestMessageType,
          }
        : null;
    case 'CLOSED':
      return { t: 'CLOSED', reason: 'HOST_LEFT' };
    case 'PING':
      return { t: 'PING' };
    default:
      return null;
  }
}

/** Hebrew for every reason a guest can be turned away. */
export const REJECT_TEXT: Record<RejectReason, string> = {
  NAME_TAKEN: 'השם הזה כבר תפוס בחדר. בחרו שם אחר',
  NAME_EMPTY: 'צריך להקליד שם',
  NAME_LONG: 'השם ארוך מדי',
  ROOM_FULL: 'החדר מלא — אפשר עד 12 שחקנים',
  ROOM_LOCKED: 'המשחק כבר התחיל. אפשר להצטרף רק לפני ההתחלה',
  BAD_VERSION: 'יש גרסה חדשה של המשחק — צריך לרענן',
  NOT_ALLOWED: 'הפעולה לא אפשרית כרגע',
  STALE: 'המשחק התקדם בינתיים',
  BAD_PAYLOAD: 'הודעה לא תקינה',
  SEAT_TAKEN: 'התחברת למקום הזה ממכשיר אחר',
};
