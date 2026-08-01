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
  leave: () => void;
};

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];

/**
 * How many times to try before saying so.
 *
 * Retrying forever looks harmless and is not: a phone whose saved session
 * points at a room that was closed hours ago will sit on "connecting…" until
 * somebody force-quits the browser, and — because the session is what sends
 * the app into the online mode on launch — it will do it again on every launch.
 * After this many retries the player gets a screen with a way out. Kept low on
 * purpose: two attempts and a short timeout means about thirteen seconds before
 * somebody is told something useful, and a player staring at a phone counts
 * every one of them.
 */
const MAX_ATTEMPTS_BEFORE_GIVING_UP = 1;

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

    const giveUp = (why: ConnectFailure): void => {
      stopped.current = true;
      // A saved session is what sends the app into the online mode on launch,
      // so a session pointing at a room that no longer exists would send this
      // phone back to the same dead screen every single time it opened the
      // game. Forget it; the player can still tap "try again" from here.
      if (why === 'NO_ROOM') clearGuestSession();
      setFailure(why);
      setStatus('UNREACHABLE');
    };

    const scheduleRetry = (why: ConnectFailure): void => {
      if (cancelled || stopped.current) return;
      // No amount of waiting conjures up a room that does not exist.
      if (why === 'NO_ROOM') {
        giveUp(why);
        return;
      }
      if (attempt.current >= MAX_ATTEMPTS_BEFORE_GIVING_UP) {
        giveUp(why);
        return;
      }
      const wait = BACKOFF_MS[Math.min(attempt.current, BACKOFF_MS.length - 1)]!;
      attempt.current++;
      retryTimer.current = window.setTimeout(() => {
        if (!cancelled && !stopped.current) setNonce((n) => n + 1);
      }, wait);
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
                setStatus('REJECTED');
              }
              return;
            case 'CLOSED':
              stopped.current = true;
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
          // is probably still there. Start the count again from zero.
          attempt.current = 0;
          scheduleRetry('NETWORK');
        });

        heardFrom.current = Date.now();
        const saved = loadGuestSession(code);
        channel.send({
          t: 'JOIN',
          v: PROTOCOL_VERSION,
          name,
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
        // Drop it ourselves rather than wait for an event that is not coming;
        // closing fires `onClose`, which starts the reconnect.
        channel.close();
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

  const retry = useCallback(() => {
    stopped.current = false;
    attempt.current = 0;
    setReason(null);
    setFailure(null);
    setNonce((n) => n + 1);
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
    channelRef.current?.send({ t: 'LEAVE' } satisfies GuestMessage);
    channelRef.current = null;
    destroyGuest();
    clearGuestSession();
  }, []);

  return {
    status,
    view,
    send,
    reason,
    failure,
    message: reason ? REJECT_TEXT[reason] : null,
    retry,
    leave,
  };
}
