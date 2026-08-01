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
]);

export function useGuest(code: string, name: string): Guest {
  const [status, setStatus] = useState<GuestStatus>('CONNECTING');
  const [view, setView] = useState<PlayerView | null>(null);
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [failure, setFailure] = useState<ConnectFailure | null>(null);

  const channelRef = useRef<Channel | null>(null);
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

        channel.onMessage((raw) => {
          const msg = parseHostMessage(raw);
          if (!msg) return;
          heardFrom.current = Date.now();
          switch (msg.t) {
            case 'PING':
              return;
            case 'WELCOME':
              saveGuestSession({ code, seatId: msg.seatId, name });
              // From here on a failure means "the host hiccuped", not "there is
              // no such room" — and the two get very different patience.
              seatedOnce.current = true;
              setStatus('PLAYING');
              setReason(null);
              return;
            case 'VIEW':
              viewRef.current = msg.view;
              setView(msg.view);
              setStatus('PLAYING');
              // A refusal belongs to the tap that caused it. Leaving it set
              // pinned a red banner over every screen for the rest of the game.
              setReason(null);
              return;
            case 'REJECTED':
              // A screen that fell behind, not a mistake the player made. The
              // host has already sent a fresh view; say nothing.
              if (msg.reason === 'STALE') return;
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
        const saved = loadGuestSession(code);
        channel.send({
          t: 'JOIN',
          v: PROTOCOL_VERSION,
          // The stored name wins: `name` is a prop captured when the component
          // mounted, so after a rename it is stale. The host ignores this on a
          // seat match anyway — belt and braces.
          name: saved?.name ?? name,
          ...(saved ? { seatId: saved.seatId } : {}),
        } satisfies GuestMessage);
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

  const rename = useCallback(
    (next: string) => {
      const channel = channelRef.current;
      if (!channel) return;
      // Deliberately no sync key: two players renaming in the same tick would
      // otherwise reject each other for no reason. The host validates the name
      // through the very gate `START_GAME` will apply later.
      channel.send({ t: 'RENAME', name: next } satisfies GuestMessage);
      // Kept locally too, so the next reconnect's JOIN carries the new name
      // rather than the one this component mounted with.
      const saved = loadGuestSession(code);
      if (saved) saveGuestSession({ ...saved, name: next });
    },
    [code],
  );

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
      channel.send({ t: 'PING' } satisfies GuestMessage);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    const bye = (): void => {
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
