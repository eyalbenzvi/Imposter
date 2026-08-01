/**
 * The guest side. Deliberately thin: it holds no game state and runs no rules,
 * it renders whatever the host last sent and posts intents back.
 *
 * The one piece of judgement here is which rejections a player should ever see.
 * `STALE` is the common one in real play — a tap that lands a fraction after
 * the room moved on — and it is not an error, it is a screen that fell behind.
 * The host answers a stale intent with a fresh view, so the screen fixes itself
 * and the player is told nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HEARTBEAT_MS,
  PROTOCOL_VERSION,
  REJECT_TEXT,
  SILENCE_TIMEOUT_MS,
  parseHostMessage,
  type GuestMessage,
  type Intent,
  type RejectReason,
} from './protocol';
import {
  ConnectError,
  destroyGuest,
  joinHost,
  type Channel,
  type ConnectFailure,
} from './peer';
import { useKeepAwake } from '../ui/useKeepAwake';
import {
  initialName,
  onReconnect,
  onRename,
  onRenameRefused,
  onView,
  type NameState,
} from './guestName';
import { nextRetry } from './retry';
import { clearGuestSession, loadGuestSession, saveGuestSession } from './storage';
import type { PlayerView } from './view';

export type GuestStatus =
  | 'CONNECTING'
  | 'JOINING'
  | 'PLAYING'
  | 'RECONNECTING'
  /** Tried and could not get through. Always escapable — see `UNREACHABLE`. */
  | 'UNREACHABLE'
  | 'REJECTED'
  | 'CLOSED';

export type Guest = {
  status: GuestStatus;
  view: PlayerView | null;
  /** Intents, with the sync key filled in from the last view received. */
  send: (msg: Intent) => void;
  reason: RejectReason | null;
  /** Why we could not get through, when `status` is UNREACHABLE. */
  failure: ConnectFailure | null;
  message: string | null;
  retry: () => void;
  /** Lobby only — the host refuses once the roster is frozen. */
  rename: (name: string) => void;
  leave: () => void;
};



/** Refusals the player has to act on. Everything else is worth retrying. */
const TERMINAL: ReadonlySet<RejectReason> = new Set<RejectReason>([
  'NAME_TAKEN',
  'NAME_EMPTY',
  'NAME_LONG',
  'ROOM_FULL',
  'ROOM_LOCKED',
  'BAD_VERSION',
  // Somebody else is now sitting here. Retrying would take the seat straight
  // back off them and start the whole exchange again from their side.
  'SEAT_TAKEN',
]);

/**
 * Terminal refusals that also mean the seat in our session no longer exists.
 *
 * A session is what sends the app straight back into the online mode on the
 * next launch, so keeping one that names a seat we were just told we cannot
 * have lands this phone on the same rejection screen every time it opens the
 * game, for the full six hours the session lives.
 *
 * `SEAT_TAKEN` is deliberately absent: the seat is real and is ours, another
 * device is simply using it. `BAD_VERSION` too — that is a refresh away from
 * working, and the seat is still there.
 */
const FORGET_SESSION: ReadonlySet<RejectReason> = new Set<RejectReason>([
  'ROOM_LOCKED',
  'ROOM_FULL',
  'NAME_TAKEN',
]);

export function useGuest(code: string, name: string): Guest {
  const [status, setStatus] = useState<GuestStatus>('CONNECTING');
  const [view, setView] = useState<PlayerView | null>(null);
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [failure, setFailure] = useState<ConnectFailure | null>(null);

  const channelRef = useRef<Channel | null>(null);
  /**
   * Everything about what this device is called — see `guestName.ts`.
   *
   * A ref rather than the `name` prop, because the prop is captured when the
   * join screen hands over and never moves again: after a rename, every
   * reconnect would introduce the player by the name they had abandoned.
   */
  const naming = useRef<NameState>(initialName(name, null));
  /** Our seat, once the host has given us one — needed to re-save the session. */
  const seatIdRef = useRef<string | null>(null);
  /** The secret that proves the seat is ours. Issued once, in `WELCOME`. */
  const tokenRef = useRef<string | null>(null);
  /** When the host last said anything. See the heartbeat effect below. */
  const heardFrom = useRef(0);
  /** Have we ever held a seat here? Changes what a failure means entirely. */
  const seatedOnce = useRef(false);
  /** When the current outage began — the clock the reconnect budget runs on. */
  const outageSince = useRef(Date.now());
  const viewRef = useRef<PlayerView | null>(null);
  const attempt = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const stopped = useRef(false);
  const [nonce, setNonce] = useState(0);

  // A guest's phone locking does not take the room down, but it does take the
  // player out of it: they miss their turn, and the room waits on somebody
  // who is looking at a lock screen.
  useKeepAwake(status !== 'UNREACHABLE' && status !== 'CLOSED' && status !== 'REJECTED');

  // A new name arriving on the prop is the player typing one in and entering
  // the room again, which outranks anything remembered from last time.
  // Declared above the connect effect so it has already run when the JOIN goes.
  useEffect(() => {
    naming.current = initialName(name, naming.current.persisted);
  }, [name]);

  /**
   * Introduce ourselves. Safe to repeat: the host keys a JOIN on the channel it
   * arrived over, so a second one over a live channel is a no-op that answers
   * with a fresh view.
   */
  const sendJoin = useCallback(
    (channel: Channel) => {
      const saved = loadGuestSession(code);
      channel.send({
        t: 'JOIN',
        v: PROTOCOL_VERSION,
        name: naming.current.intended,
        // Both or neither: the seat id alone is guessable and proves nothing,
        // so the host ignores it without the token that came with it.
        ...(saved?.token ? { seatId: saved.seatId, token: saved.token } : {}),
      } satisfies GuestMessage);
    },
    [code],
  );

  useEffect(() => {
    stopped.current = false;
    let cancelled = false;

    const scheduleRetry = (why: ConnectFailure): void => {
      if (cancelled || stopped.current) return;
      const decision = nextRetry(
        {
          seatedOnce: seatedOnce.current,
          attempt: attempt.current,
          since: outageSince.current,
        },
        why,
        Date.now(),
      );

      if (decision.action === 'GIVE_UP') {
        stopped.current = true;
        // A session pointing at a room that never answered would send this
        // phone back to the same dead screen on every launch. A seated
        // player's session is the opposite — it is how they get back in.
        if (decision.clearSession) clearGuestSession();
        setFailure(why);
        setStatus('UNREACHABLE');
        return;
      }

      attempt.current++;
      retryTimer.current = window.setTimeout(() => {
        if (!cancelled && !stopped.current) setNonce((n) => n + 1);
      }, decision.delayMs);
    };

    setStatus(viewRef.current ? 'RECONNECTING' : 'CONNECTING');

    void joinHost(code)
      .then(({ channel }) => {
        // Not destroyed on cancel: the channel is a per-tab singleton, and a
        // StrictMode remount is already waiting on the very same one.
        if (cancelled) return;
        channelRef.current = channel;
        attempt.current = 0;
        setStatus('JOINING');

        // A rename in flight when the channel dropped is simply lost: the host
        // either applied it or did not, and its next `VIEW` says which.
        const saved = loadGuestSession(code);
        naming.current = onReconnect(naming.current, saved?.name ?? null);

        channel.onMessage((raw) => {
          const msg = parseHostMessage(raw);
          if (!msg) return;
          heardFrom.current = Date.now();
          switch (msg.t) {
            case 'PING':
              return;
            case 'WELCOME':
              seatIdRef.current = msg.seatId;
              tokenRef.current = msg.token;
              // The seat and the token are what `WELCOME` is authoritative
              // about, and they are written straight away — the token is how
              // this device gets back in, and a drop before the first `VIEW`
              // would otherwise cost it the seat.
              //
              // The *name* is deliberately not touched. The host ignores the
              // name in a reclaiming JOIN, so what we asked to be called is
              // not what it has us down as; writing it here would persist a
              // name the host never agreed to. `VIEW` knows the answer.
              saveGuestSession({
                code,
                seatId: msg.seatId,
                token: msg.token,
                name: naming.current.persisted ?? naming.current.intended,
              });
              // From here on a failure means "the host hiccuped", not "there is
              // no such room" — and the two get very different patience.
              seatedOnce.current = true;
              setStatus('PLAYING');
              setReason(null);
              return;
            case 'VIEW': {
              viewRef.current = msg.view;
              setView(msg.view);
              setStatus('PLAYING');
              // A refusal belongs to the tap that caused it. Leaving it set
              // pinned a red banner over every screen for the rest of the game.
              setReason(null);

              // The host's copy of our name is the only authority on it, and
              // this is where it arrives. Every decision that follows from it
              // lives in `guestName.ts`.
              const out = onView(
                naming.current,
                msg.view.you.name,
                msg.view.phase === 'SETUP',
              );
              const seatId = seatIdRef.current;
              // The machine records what it believes is on disk, so it must
              // not be told a write happened that did not. Nothing can reach a
              // view before its `WELCOME` — the host only pushes to a channel
              // that holds a seat, over an ordered channel — but "provably
              // unreachable" is a poor thing for a persist path to rest on.
              naming.current =
                out.persist !== undefined && seatId === null
                  ? { ...out.state, persisted: naming.current.persisted }
                  : out.state;
              if (out.rename !== undefined) {
                channel.send({ t: 'RENAME', name: out.rename } satisfies GuestMessage);
              }
              if (out.persist !== undefined && seatId !== null) {
                saveGuestSession({
                  code,
                  seatId,
                  token: tokenRef.current ?? undefined,
                  name: out.persist,
                });
              }
              return;
            }
            case 'REJECTED':
              // A screen that fell behind, not a mistake the player made. The
              // host has already sent a fresh view; say nothing.
              if (msg.reason === 'STALE') return;
              // A refused rename leaves us still called what we were called,
              // and is only worth saying out loud sometimes — see
              // `onRenameRefused`.
              if (msg.on === 'RENAME') {
                const out = onRenameRefused(naming.current, msg.reason);
                naming.current = out.state;
                if (!out.surface) return;
              }
              setReason(msg.reason);
              // Only a refusal the player can actually do something about ends
              // the attempt. Anything else stays in the backoff loop, so a
              // transient no during a reconnect does not throw them out of a
              // game they are still sitting in.
              if (msg.on === 'JOIN' && TERMINAL.has(msg.reason)) {
                stopped.current = true;
                // Drop the channel reference too, or the heartbeat below keeps
                // pinging forever — which keeps the host's `lastSeen` fresh and
                // makes this channel permanently un-sweepable on their side.
                channelRef.current = null;
                // Scoped to the room that refused us. `clearGuestSession` is
                // room-agnostic, so an unscoped call would let a failed
                // attempt to join a *second* room — from a shared link, say —
                // delete the session for the game this phone is still seated
                // in, which is the one thing that gets it back there.
                if (FORGET_SESSION.has(msg.reason) && loadGuestSession(code)) {
                  clearGuestSession();
                }
                setStatus('REJECTED');
              }
              return;
            case 'CLOSED':
              stopped.current = true;
              channelRef.current = null;
              clearGuestSession();
              setStatus('CLOSED');
              return;
          }
        });

        channel.onClose(() => {
          if (cancelled || stopped.current) return;
          channelRef.current = null;
          setStatus('RECONNECTING');
          // A channel that was open and then dropped is worth chasing: the host
          // is probably still there. Fresh count, fresh clock.
          attempt.current = 0;
          outageSince.current = Date.now();
          scheduleRetry('NETWORK');
        });

        heardFrom.current = Date.now();
        sendJoin(channel);
      })
      .catch((err: unknown) => {
        if (cancelled || stopped.current) return;
        scheduleRetry(err instanceof ConnectError ? err.kind : 'NETWORK');
      });

    return () => {
      cancelled = true;
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      // The channel is dropped, but the peer is left for the browser to reap:
      // StrictMode remounts this effect immediately in development, and a
      // synchronous destroy would kill the connection the remount is using.
      channelRef.current = null;
    };
  }, [code, name, nonce]);

  /**
   * Say "still here", and notice when the host stops saying it.
   *
   * The guest has the mirror image of the host's problem: a host whose tab is
   * killed or whose phone locks leaves this data channel looking perfectly
   * open, so without listening for silence a player can sit in a room that
   * stopped existing minutes ago.
   */
  useEffect(() => {
    const id = window.setInterval(() => {
      const channel = channelRef.current;
      if (!channel?.isOpen()) return;
      channel.send({ t: 'PING' } satisfies GuestMessage);
      if (Date.now() - heardFrom.current > SILENCE_TIMEOUT_MS) {
        // `drop()`, not `close()`. Closing is the silent form — it tears the
        // channel down without telling anyone, so the reconnect this exists to
        // start would never happen and the screen would freeze for good.
        channel.drop();
      }
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, []);

  const send = useCallback<Guest['send']>((msg) => {
    const channel = channelRef.current;
    const key = viewRef.current?.key;
    if (!channel || key === undefined) return;
    channel.send({ ...msg, key } as GuestMessage);
  }, []);

  const rename = useCallback((next: string) => {
    const channel = channelRef.current;
    if (!channel) return;
    // Deliberately no sync key: two players renaming in the same tick would
    // otherwise reject each other for no reason. The host validates the name
    // through the very gate `START_GAME` will apply later.
    const out = onRename(naming.current, next);
    naming.current = out.state;
    channel.send({ t: 'RENAME', name: out.rename! } satisfies GuestMessage);
    // Nothing is written to storage here. The host may well refuse this — the
    // name may be taken, or the roster already frozen — and a stored name it
    // never accepted would be re-sent by every reconnect from now on. The
    // `VIEW` that follows an accepted rename is what persists it.
  }, []);

  const retry = useCallback(() => {
    stopped.current = false;
    attempt.current = 0;
    setReason(null);
    setFailure(null);
    setNonce((n) => n + 1);
  }, []);

  /**
   * Coming back from the background.
   *
   * The host has the same handler for the same reason: while the tab was
   * suspended no intervals ran and no events were delivered, so the first thing
   * the heartbeat would otherwise do on resume is read the silence as the host
   * being gone — on a channel that is perfectly alive.
   */
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      // A player who has been told the room closed, or that they were refused,
      // stays told. Without this, switching apps and back would quietly clear
      // their terminal state and start re-dialling a room that no longer
      // exists — the exact loop the unreachable screen was written to end.
      if (stopped.current) return;
      const channel = channelRef.current;
      if (!channel || !channel.isOpen()) {
        attempt.current = 0;
        outageSince.current = Date.now();
        setNonce((n) => n + 1);
        return;
      }
      heardFrom.current = Date.now();
      // Not just a PING. The `pagehide` below may have said `LEAVE` on the way
      // out — the browser fires it for an ordinary background, not only for a
      // close — and in the lobby that removes the seat outright. Nothing else
      // would ever put it back: the channel is still open, so no reconnect is
      // scheduled, and the host stops broadcasting to a player it no longer
      // has. Saying hello again costs one message and fixes all three cases
      // (seat intact, seat disconnected, seat gone).
      sendJoin(channel);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [sendJoin]);

  useEffect(() => {
    const bye = (event: Event): void => {
      // `persisted` means the page is being frozen, not closed — it can come
      // back, and on mobile it usually does. Announcing a departure for one is
      // how a player who switched apps for ten seconds found the game had
      // started without them.
      if ((event as PageTransitionEvent).persisted) return;
      channelRef.current?.send({ t: 'LEAVE' } satisfies GuestMessage);
    };
    // `pagehide` is the one mobile Safari actually fires; `beforeunload` covers
    // the rest. Best-effort — the heartbeat is what makes it correct.
    window.addEventListener('pagehide', bye);
    window.addEventListener('beforeunload', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      window.removeEventListener('beforeunload', bye);
    };
  }, []);

  const leave = useCallback(() => {
    stopped.current = true;
    const channel = channelRef.current;
    channel?.send({ t: 'LEAVE' } satisfies GuestMessage);
    // Same drain as the host's close: destroying the peer immediately would
    // take the LEAVE with it, and the host would hold a phantom seat for the
    // full silence timeout instead of freeing it now.
    channel?.closeGracefully();
    channelRef.current = null;
    clearGuestSession();
    window.setTimeout(() => destroyGuest(), 300);
  }, []);

  return {
    status,
    view,
    send,
    reason,
    failure,
    message: reason ? REJECT_TEXT[reason] : null,
    retry,
    rename,
    leave,
  };
}
