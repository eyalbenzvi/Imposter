/**
 * The host side: plumbing, and nothing else.
 *
 * Every rule lives in `driver.ts`, which is pure. This file only moves bytes
 * between data channels and that driver, and tells React when to paint.
 *
 * The one thing worth understanding here is why the room lives in a ref rather
 * than in `useState`. Intents arrive in bursts — a stalled radio delivers four
 * queued messages in a single macrotask — and each one has to be judged against
 * the state the previous one left behind. React state does not update until the
 * next render, so a burst validated against `useState` would judge messages 2,
 * 3 and 4 against a state that message 1 already moved past: votes accepted
 * into a bucket that was just emptied, actions dispatched into a phase that no
 * longer exists. The ref is advanced synchronously; React state carries only a
 * version number, purely to schedule a repaint.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { maxImposterCount } from '../game/rules';
import type { Settings } from '../game/types';
import { newSeed } from '../ui/useGame';
import {
  blockedOnDisconnected,
  dropConnection,
  handleIntent,
  handleJoin,
  hostCommand,
  renameSeat,
  startGame,
  type Env,
} from './driver';
import {
  ConnectError,
  destroyHost,
  openHost,
  randomCode,
  type Channel,
  type HostPeer,
} from './peer';
import {
  HEARTBEAT_MS,
  PROTOCOL_VERSION,
  REJECT_TEXT,
  SILENCE_TIMEOUT_MS,
  parseGuestMessage,
  type GuestMessage,
  type HostCommand,
  type HostMessage,
  type Intent,
  type SeatId,
} from './protocol';
import {
  createRoom,
  emptyPending,
  seatById,
  seatByConn,
  seatOrderIsSound,
  staleConnIds,
  type Room,
  type Seat,
} from './room';
import {
  clearHostSession,
  loadHostSession,
  saveHostSession,
} from './storage';
import { useKeepAwake } from '../ui/useKeepAwake';
import { projectView, type PlayerView } from './view';

export type HostStatus =
  | 'OPENING'
  /** Open and reachable: existing players are fine and new ones can join. */
  | 'OPEN'
  /**
   * The game is running, but the signalling socket is down — so nobody new can
   * find the room. Existing data channels are unaffected, which is exactly why
   * this needs saying out loud: everything looks fine from the host's chair.
   */
  | 'DEGRADED'
  | 'ERROR';

export type Host = {
  status: HostStatus;
  code: string | null;
  seats: Seat[];
  /** The host's own screen — the same projection every guest gets. */
  view: PlayerView | null;
  phase: Room['state']['phase'];
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  start: () => void;
  /** The host plays too, through exactly the same intent path as everyone. */
  act: (msg: Intent) => void;
  command: (cmd: HostCommand) => void;
  /** True once somebody the room is waiting for has dropped off. */
  stuck: boolean;
  error: string | null;
  closeRoom: () => void;
};

/** Keep the imposter count inside what the current roster can support. */
function clampSettings(settings: Settings, playerCount: number): Settings {
  if (playerCount < 1) return settings;
  const cap = maxImposterCount(playerCount);
  const imposterCount = Math.min(Math.max(1, settings.imposterCount), cap);
  return imposterCount === settings.imposterCount ? settings : { ...settings, imposterCount };
}

function env(): Env {
  return { seed: newSeed(), now: Date.now() };
}

function restore(hostName: string): Room {
  const saved = loadHostSession();
  if (!saved) return createRoom(randomCode(), hostName);
  return {
    code: saved.code,
    seats: saved.seats,
    seatOrder: saved.seatOrder,
    locked: saved.locked,
    settings: saved.settings,
    state: saved.state,
    pending: emptyPending(),
    epoch: saved.epoch,
    version: saved.epoch,
    deadlineAt: null,
  };
}

export function useHost(hostName: string): Host {
  const roomRef = useRef<Room | null>(null);
  if (roomRef.current === null) roomRef.current = restore(hostName);

  const [version, setVersion] = useState(roomRef.current.version);
  const [status, setStatus] = useState<HostStatus>('OPENING');
  const [code, setCode] = useState<string | null>(roomRef.current.code);
  const [error, setError] = useState<string | null>(null);

  const peerRef = useRef<HostPeer | null>(null);
  /** connId → channel, for everyone currently attached. */
  const channels = useRef(new Map<string, Channel>());
  /** connId → when we last heard anything at all from it. */
  const lastSeen = useRef(new Map<string, number>());
  /** Detects the clock jumping because the tab was suspended. */
  const lastSweepAt = useRef(Date.now());

  // ── sending ───────────────────────────────────────────────────────────────

  const viewFor = useCallback((seatId: SeatId): PlayerView | null => {
    const room = roomRef.current!;
    if (!seatOrderIsSound(room)) return null;
    return projectView(room, seatId, Date.now());
  }, []);

  const sendTo = useCallback((channel: Channel, msg: HostMessage) => {
    channel.send(msg);
  }, []);

  /**
   * Let a channel deliver what is already queued, then let it go.
   *
   * `close()` tears the RTCPeerConnection down synchronously and whatever is
   * still in the send buffer goes with it — which is how a final `REJECTED` or
   * `CLOSED` never reaches the person it was written for. `closeGracefully()`
   * asks the far side to close and leaves this side up; the wait is what
   * actually drains the buffer.
   */
  const retire = useCallback((channel: Channel, drainMs: number) => {
    channel.closeGracefully();
    window.setTimeout(() => {
      channel.close();
      channels.current.delete(channel.id);
      lastSeen.current.delete(channel.id);
    }, drainMs);
  }, []);

  const pushView = useCallback(
    (channel: Channel, seatId: SeatId) => {
      const view = viewFor(seatId);
      if (view) sendTo(channel, { t: 'VIEW', view });
    },
    [sendTo, viewFor],
  );

  const broadcast = useCallback(() => {
    const room = roomRef.current!;
    if (!seatOrderIsSound(room)) {
      // Identity is the one thing that must never be guessed at. A room whose
      // seat map has drifted from its roster would hand somebody another
      // player's word, so nothing goes out at all — and `view` below returns
      // null through the same gate, which puts the host on an error screen
      // rather than leaving them playing a game nobody else can see.
      setError('משהו השתבש בזיהוי השחקנים — צריך לפתוח חדר מחדש');
      return;
    }
    for (const seat of room.seats) {
      if (seat.isHost || seat.connId === null) continue;
      const channel = channels.current.get(seat.connId);
      if (channel?.isOpen()) pushView(channel, seat.seatId);
    }
  }, [pushView]);

  const commit = useCallback((next: Room) => {
    roomRef.current = next;
    setVersion(next.version);
  }, []);

  // Every change — including one that only landed in `pending` — repaints and
  // re-broadcasts, which is what keeps the live "4 / 6 voted" counters moving
  // while the game state itself stands still.
  useEffect(() => {
    broadcast();
  }, [version, broadcast]);

  // Persistence keeps up with the game and with the host's settings, but not
  // with every tap of a counter — serializing the whole room on each intent
  // would put a localStorage write in the path of every message.
  //
  // And nothing is written until the room means something. A session saved the
  // instant this hook mounts survives its 6-hour TTL, so a host who merely
  // glanced at the lobby and hit Back would find every later launch of the app
  // opening the online mode instead of the single-device game they wanted.
  const room = roomRef.current;
  const worthKeeping = room.locked || room.seats.length > 1;
  // A rename moves neither the epoch nor the seat count, so without a name
  // signature here it would survive until the host refreshed and then vanish.
  const nameSignature = room.seats.map((s) => s.name).join('\u0000');
  useEffect(() => {
    if (worthKeeping) saveHostSession(roomRef.current!);
  }, [worthKeeping, room.epoch, room.settings, room.seats.length, nameSignature]);

  // ── receiving ─────────────────────────────────────────────────────────────

  const onMessage = useCallback(
    (channel: Channel, raw: unknown) => {
      const msg = parseGuestMessage(raw);
      const room = roomRef.current!;
      // Any message at all is proof of life, including one we go on to reject.
      lastSeen.current.set(channel.id, Date.now());
      if (!msg) {
        sendTo(channel, { t: 'REJECTED', reason: 'BAD_PAYLOAD', key: null, on: 'JOIN' });
        return;
      }

      if (msg.t === 'JOIN') {
        const out = handleJoin(room, channel.id, msg, newSeed());
        if (!out.accepted || !out.seatId) {
          sendTo(channel, {
            t: 'REJECTED',
            reason: out.reason ?? 'NOT_ALLOWED',
            key: null,
            on: 'JOIN',
          });
          // Gracefully, so the rejection actually leaves the buffer: a bare
          // close drops it, and the guest retries forever without ever being
          // told why they were refused.
          retire(channel, 400);
          return;
        }

        // The seat may have been taken from a channel that is still perfectly
        // alive — two tabs, or a phone that recovered on its own. It will never
        // go silent, so it would never be swept; it would just sit there
        // collecting `NOT_ALLOWED` for every tap.
        //
        // It is told why before it goes. Hanging up in silence looks to the
        // other end like an ordinary drop, so it reconnects, takes the seat
        // straight back, and the two spend the evening evicting each other a
        // second apart. `SEAT_TAKEN` is terminal on the guest side, which is
        // what actually ends the war.
        if (out.displaced) {
          const old = channels.current.get(out.displaced);
          if (old) {
            sendTo(old, { t: 'REJECTED', reason: 'SEAT_TAKEN', key: null, on: 'JOIN' });
            retire(old, 400);
          }
        }

        commit(out.room);
        // Read back from the committed room, not from the token we minted: on
        // a reclaim the seat kept the one it already had.
        const token = seatById(out.room, out.seatId)?.token ?? '';
        sendTo(channel, {
          t: 'WELCOME',
          v: PROTOCOL_VERSION,
          seatId: out.seatId,
          token,
        });
        // Straight away, not on the next state change: a guest reconnecting
        // mid-discussion would otherwise sit on a blank screen until something
        // moved — and the thing that would move it is their own missing tap.
        // `commit` has already advanced the ref, so this reads the new room.
        pushView(channel, out.seatId);
        return;
      }

      // A heartbeat is only ever "still here" — recording the sighting above
      // is the entire handling.
      if (msg.t === 'PING') return;

      if (msg.t === 'LEAVE') {
        commit(dropConnection(room, channel.id));
        return;
      }

      const seat = seatByConn(room, channel.id);
      if (!seat) {
        sendTo(channel, { t: 'REJECTED', reason: 'NOT_ALLOWED', key: null, on: msg.t });
        return;
      }

      // Routed here rather than through `handleIntent`: renaming is a lobby
      // operation, and the intent gate refuses everything in SETUP and needs a
      // player id that does not exist until the game starts.
      if (msg.t === 'RENAME') {
        const out = renameSeat(room, seat.seatId, msg.name);
        if (!out.accepted) {
          sendTo(channel, {
            t: 'REJECTED',
            reason: out.reason ?? 'NOT_ALLOWED',
            key: null,
            on: 'RENAME',
          });
          return;
        }
        commit(out.room);
        pushView(channel, seat.seatId);
        return;
      }

      const out = handleIntent(room, seat.seatId, msg, env());
      if (!out.accepted) {
        sendTo(channel, {
          t: 'REJECTED',
          reason: out.reason ?? 'NOT_ALLOWED',
          key: msg.key,
          on: msg.t,
        });
        // A stale tap is not an error, it is a screen that fell behind. Send
        // the current one and let the guest catch up in silence.
        if (out.reason === 'STALE') pushView(channel, seat.seatId);
        return;
      }
      commit(out.room);
    },
    [commit, pushView, retire, sendTo],
  );

  // ── the peer ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const saved = loadHostSession();

    // `preferredCode` only for a host who is genuinely coming back. A fresh
    // host's code is a number `restore()` drew a moment ago and nobody has
    // seen — insisting on it turned a one-in-900,000 collision into 75 seconds
    // of "פותחים חדר…" followed by "the previous room code is no longer
    // available", and made the draw-another-number fallback unreachable.
    void openHost(saved?.code ? { preferredCode: saved.code } : {})
      .then((peer) => {
        // Deliberately no teardown. StrictMode's first mount is cancelled
        // while the second is already awaiting this very promise, so
        // destroying here would kill the peer the surviving mount goes on to
        // use — leaving a lobby showing a code whose id has been released.
        // `closeRoom` is the only teardown, exactly as the cleanup below says.
        if (cancelled) return;
        peerRef.current = peer;
        setCode(peer.code);
        // The code is part of the room's identity: a retry that lands on a
        // different number has to be reflected, or the lobby shows one number
        // and the broker answers another.
        if (peer.code !== roomRef.current!.code) {
          commit({ ...roomRef.current!, code: peer.code, version: roomRef.current!.version + 1 });
        }
        setStatus('OPEN');

        peer.onBroker((state) => {
          setStatus(state === 'UP' ? 'OPEN' : 'DEGRADED');
        });

        peer.onConnect((channel) => {
          channels.current.set(channel.id, channel);
          // Counted as seen the moment it opens, so the sweep below cannot
          // reap a channel that simply has not spoken yet.
          lastSeen.current.set(channel.id, Date.now());
          channel.onMessage((raw) => onMessage(channel, raw));
          channel.onClose(() => {
            channels.current.delete(channel.id);
            lastSeen.current.delete(channel.id);
            commit(dropConnection(roomRef.current!, channel.id));
          });
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('ERROR');
        setError(
          err instanceof ConnectError && err.kind === 'CODE_LOST'
            ? 'קוד החדר הקודם כבר לא זמין. פתחו חדר חדש והקריאו את המספר החדש'
            : 'לא הצלחנו לפתוח חדר. בדקו את החיבור לרשת ונסו שוב',
        );
      });

    return () => {
      cancelled = true;
      // Deliberately NOT destroying the peer here. React's StrictMode mounts,
      // unmounts and remounts every effect in development, and the broker holds
      // a peer id reserved for a while after it is destroyed — tearing down
      // synchronously means the remount cannot have its own code back.
      // `closeRoom` is the real teardown.
    };
    // Mount once: the room's identity does not change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Heartbeat, and the sweep that acts on its absence.
   *
   * `channel.onClose` only fires on a *graceful* close. A tab that is killed, a
   * phone that locks, a wifi that drops — none of them produce a close event on
   * this side, so a player could vanish and stay on the roster indefinitely.
   * Silence is the signal that always arrives.
   *
   * The sweep walks the channel table rather than the seat list, so it also
   * reaps channels that hold no seat: one refused entry, one displaced by a
   * reconnect. Walking seats could never see either, and they accumulated for
   * the whole evening.
   */
  useEffect(() => {
    const beat = window.setInterval(() => {
      for (const channel of channels.current.values()) {
        if (channel.isOpen()) channel.send({ t: 'PING' } satisfies HostMessage);
      }
    }, HEARTBEAT_MS);

    const sweep = window.setInterval(() => {
      const now = Date.now();
      const gap = now - lastSweepAt.current;
      lastSweepAt.current = now;

      // The interval did not run while the tab was suspended, so the first tick
      // after waking sees every channel as ancient and would evict the entire
      // room at once. A gap larger than the timeout means we were asleep, not
      // that eleven people left simultaneously.
      if (gap > SILENCE_TIMEOUT_MS) {
        for (const connId of channels.current.keys()) lastSeen.current.set(connId, now);
        return;
      }

      const gone = staleConnIds(
        channels.current.keys(),
        lastSeen.current,
        now,
        SILENCE_TIMEOUT_MS,
      );
      if (gone.length === 0) return;
      let next = roomRef.current!;
      for (const connId of gone) {
        channels.current.get(connId)?.close();
        channels.current.delete(connId);
        lastSeen.current.delete(connId);
        // A no-op for a channel that holds no seat, which is the point.
        next = dropConnection(next, connId);
      }
      if (next !== roomRef.current) commit(next);
    }, HEARTBEAT_MS);

    return () => {
      window.clearInterval(beat);
      window.clearInterval(sweep);
    };
  }, [commit]);

  // The host's phone must not lock: it is the device the room runs on.
  useKeepAwake(true);

  // And pick the pieces back up when the host returns from another app — iOS
  // suspends a backgrounded tab and drops its channels.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      // Nobody went quiet while we were asleep; we just stopped listening.
      // Without this the next sweep reads the whole room as silent.
      const now = Date.now();
      for (const connId of channels.current.keys()) lastSeen.current.set(connId, now);
      lastSweepAt.current = now;
      peerRef.current?.reconnect();
      broadcast();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [broadcast]);

  // ── the host's own controls ───────────────────────────────────────────────

  const setSettings = useCallback(
    (patch: Partial<Settings>) => {
      const current = roomRef.current!;
      commit({
        ...current,
        // Clamped here rather than left to the reducer, which only sees these
        // at START_GAME. Two players leaving a seven-player lobby would
        // otherwise leave "2 imposters" lit on a roster that can only take one,
        // and the game would quietly start with a different setup than the one
        // on screen.
        settings: clampSettings(
          { ...current.settings, ...patch },
          current.seats.length,
        ),
        version: current.version + 1,
      });
    },
    [commit],
  );

  // Seats come and go in the lobby, so the cap moves under the chosen value.
  useEffect(() => {
    const current = roomRef.current!;
    if (current.locked) return;
    const clamped = clampSettings(current.settings, current.seats.length);
    if (clamped.imposterCount === current.settings.imposterCount) return;
    commit({ ...current, settings: clamped, version: current.version + 1 });
  }, [room.seats.length, commit, room.locked]);

  const start = useCallback(() => {
    const out = startGame(roomRef.current!, env());
    if (!out.accepted) {
      setError('אי אפשר להתחיל — צריך לפחות 3 שחקנים עם שמות שונים');
      return;
    }
    setError(null);
    commit(out.room);
  }, [commit]);

  const act = useCallback<Host['act']>(
    (msg) => {
      const room = roomRef.current!;
      // The host plays through the same gate as everybody else, key and all —
      // there is no privileged path into the driver. Overrides go through
      // `command`, and are labelled as such.
      const out = handleIntent(
        room,
        room.seats[0]!.seatId,
        { ...msg, key: String(room.epoch) } as GuestMessage,
        env(),
      );
      if (out.accepted) commit(out.room);
    },
    [commit],
  );

  const command = useCallback(
    (cmd: HostCommand) => {
      const out = hostCommand(roomRef.current!, cmd, env());
      // Cleared on success as well as set on failure. Without it, one refused
      // rename left a red line under "התחילו לשחק" and inside the name editor
      // for the rest of the lobby, including after a name that was accepted.
      if (out.accepted) {
        setError(null);
        commit(out.room);
      } else setError(out.reason ? REJECT_TEXT[out.reason] : 'הפעולה נכשלה');
    },
    [commit],
  );

  const closeRoom = useCallback(() => {
    for (const channel of channels.current.values()) {
      channel.send({ t: 'CLOSED', reason: 'HOST_LEFT' } satisfies HostMessage);
      channel.closeGracefully();
    }
    channels.current.clear();
    lastSeen.current.clear();
    peerRef.current = null;
    // The cache is cleared synchronously inside `destroyHost`; only the teardown
    // waits, so that "the host closed the room" actually arrives instead of
    // being dropped with the connection. Without the wait every guest gets a
    // bare disconnect and burns their retry budget on a room that is gone.
    destroyHost(400);
    clearHostSession();
  }, []);

  return {
    status,
    code,
    seats: room.seats,
    // Through the same soundness gate the guests' views go through.
    view: room.seats[0] ? viewFor(room.seats[0].seatId) : null,
    phase: room.state.phase,
    settings: room.settings,
    setSettings,
    start,
    act,
    command,
    stuck: blockedOnDisconnected(room),
    error,
    closeRoom,
  };
}
