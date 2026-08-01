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
  PROTOCOL_VERSION,
  REJECT_TEXT,
  parseHostMessage,
  type GuestMessage,
  type Intent,
  type RejectReason,
} from './protocol';
import { destroyGuest, joinHost, type Channel } from './peer';
import { clearGuestSession, loadGuestSession, saveGuestSession } from './storage';
import type { PlayerView } from './view';

export type GuestStatus =
  | 'CONNECTING'
  | 'JOINING'
  | 'PLAYING'
  | 'RECONNECTING'
  | 'REJECTED'
  | 'CLOSED';

export type Guest = {
  status: GuestStatus;
  view: PlayerView | null;
  /** Intents, with the sync key filled in from the last view received. */
  send: (msg: Intent) => void;
  reason: RejectReason | null;
  message: string | null;
  retry: () => void;
  leave: () => void;
};

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000];

export function useGuest(code: string, name: string): Guest {
  const [status, setStatus] = useState<GuestStatus>('CONNECTING');
  const [view, setView] = useState<PlayerView | null>(null);
  const [reason, setReason] = useState<RejectReason | null>(null);

  const channelRef = useRef<Channel | null>(null);
  const viewRef = useRef<PlayerView | null>(null);
  const attempt = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const stopped = useRef(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    stopped.current = false;
    let cancelled = false;

    const scheduleRetry = (): void => {
      if (cancelled || stopped.current) return;
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
          switch (msg.t) {
            case 'WELCOME':
              saveGuestSession({ code, seatId: msg.seatId, name });
              setStatus('PLAYING');
              setReason(null);
              return;
            case 'VIEW':
              viewRef.current = msg.view;
              setView(msg.view);
              setStatus('PLAYING');
              return;
            case 'REJECTED':
              // A screen that fell behind, not a mistake the player made. The
              // host has already sent a fresh view; say nothing.
              if (msg.reason === 'STALE') return;
              setReason(msg.reason);
              if (msg.on === 'JOIN') {
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
          scheduleRetry();
        });

        const saved = loadGuestSession(code);
        channel.send({
          t: 'JOIN',
          v: PROTOCOL_VERSION,
          name,
          ...(saved ? { seatId: saved.seatId } : {}),
        } satisfies GuestMessage);
      })
      .catch(() => {
        if (cancelled || stopped.current) return;
        scheduleRetry();
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
    setNonce((n) => n + 1);
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
    message: reason ? REJECT_TEXT[reason] : null,
    retry,
    leave,
  };
}
