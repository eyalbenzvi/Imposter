/**
 * The only file that knows PeerJS exists.
 *
 * WebRTC needs *some* rendezvous service to introduce two browsers to each
 * other — there is no way around that without a server of our own. PeerJS's
 * public broker does it for free, with no account and nothing to deploy, and
 * it only matters for the handshake: once a data channel is up the game runs
 * peer-to-peer, so the broker going down mid-party costs nothing but new
 * joiners. Swapping it for Trystero or a self-hosted PeerServer means
 * rewriting this file and nothing else.
 */

import Peer from 'peerjs';
import { makeBrokerLoop, type BrokerState } from './brokerLoop';
import { wrap, type Channel, type RawConn } from './channel';
import {
  GUEST_CONNECT_TIMEOUT_MS,
  HOST_CONNECT_TIMEOUT_MS,
  ICE_CONFIG,
  INCOMING_OPEN_TIMEOUT_MS,
  guestPeerId,
  randomCode,
  roomPeerId,
} from './peerIds';

export { ICE_CONFIG, guestPeerId, randomCode, roomPeerId } from './peerIds';

export type { Channel } from './channel';

/**
 * Why a connection attempt failed, in the flavours that change what a player
 * should be told or what the app should do next.
 *
 * PeerJS reports "there is no such peer" and "the broker is not answering" as
 * ordinary errors, and without telling them apart the app can only shrug and
 * retry — which is how a phone ended up re-dialling a room closed hours
 * earlier, forever, with nothing on screen to say so.
 */
export type ConnectFailure = 'NO_ROOM' | 'TIMEOUT' | 'NETWORK' | 'CODE_LOST';

export class ConnectError extends Error {
  readonly kind: ConnectFailure;
  constructor(kind: ConnectFailure, message: string) {
    super(message);
    this.name = 'ConnectError';
    this.kind = kind;
  }
}

export type GuestPeer = { channel: Channel; destroy(): void };

export type HostPeer = {
  code: string;
  /** Replaces the handler rather than adding one — see the singleton note. */
  onConnect(cb: (channel: Channel) => void): void;
  /**
   * Watch the signalling socket.
   *
   * A setter, not an `openHost` option, for the same reason `onConnect` is one:
   * `openHost` hands back a cached promise, so a second caller's option would
   * be silently dropped and the peer left wired to a torn-down closure. The
   * current state is replayed immediately, so a late subscriber is never stuck
   * believing everything is fine.
   */
  onBroker(cb: (state: BrokerState) => void): void;
  /** Prod the broker after the tab has been backgrounded. */
  reconnect(): void;
  destroy(): void;
};

export type OpenHostOptions = {
  /**
   * Try this code first and keep retrying it rather than drawing a new one.
   *
   * A host who refreshes mid-game must come back on the *same* code: their
   * guests are sitting there retrying it, and the broker holds the old id
   * reserved for a while after the tab dies. Drawing a fresh code would leave
   * everyone stranded on a number that will never answer.
   */
  preferredCode?: string;
  /** How long to keep fighting for `preferredCode` before giving up on it. */
  retainMs?: number;
};

const RETAIN_MS = 75_000;
const RETRY_STEP_MS = 3_000;

/**
 * PeerJS error types that mean *the signalling socket*, as opposed to the ones
 * that mean *one guest's handshake*.
 *
 * The distinction only matters after the room is open, and there it matters a
 * lot: everything PeerJS can go wrong with arrives on the same `'error'`
 * event, and the room is only degraded for the subset below.
 */
const BROKER_ERRORS = new Set([
  'network',
  'socket-error',
  'socket-closed',
  'server-error',
  'disconnected',
  'unavailable-id',
]);

function isBrokerError(type: string | undefined): boolean {
  return type !== undefined && BROKER_ERRORS.has(type);
}

/**
 * At most one host peer per tab, ever.
 *
 * React's StrictMode mounts every effect, tears it down and mounts it again.
 * Without this, the second mount asks the broker for an id the first mount is
 * still holding, gets `unavailable-id`, and then spends 45 seconds losing a
 * fight with itself — so in development the room never opens. Handing the same
 * peer back to both mounts is both correct and simpler than trying to sequence
 * the teardown.
 */
type HostEntry = { promise: Promise<HostPeer>; peer: HostPeer | null; dead: boolean };

let live: HostEntry | null = null;

export function openHost(options: OpenHostOptions = {}): Promise<HostPeer> {
  if (live) return live.promise;
  const promise = createHost(options);
  const entry: HostEntry = { promise, peer: null, dead: false };
  live = entry;
  promise.then(
    (peer) => {
      entry.peer = peer;
      // Closed while we were still opening. The broker holds the id either
      // way, so the only question is whether anything is still listening on
      // it — and nobody is.
      if (entry.dead) peer.destroy();
    },
    () => {
      if (live === entry) live = null;
    },
  );
  return promise;
}

/**
 * The real teardown. Only `closeRoom` calls this, never an effect cleanup.
 *
 * The cache is cleared **synchronously** even when the destroy is deferred. A
 * deferred teardown that left `live` in place would hand the dying peer to
 * whoever opened the next room inside the delay window — and then kill it
 * under them, leaving a lobby showing a code nobody can reach.
 */
export function destroyHost(afterMs = 0): void {
  const entry = live;
  live = null;
  if (!entry) return;
  // Marked before the null check on `peer`: a room closed during the six
  // seconds it takes to open leaves a live Peer holding a broker socket and
  // the room's id, with nothing on either end of it.
  entry.dead = true;
  const peer = entry.peer;
  if (!peer) return;
  if (afterMs <= 0) peer.destroy();
  else window.setTimeout(() => peer.destroy(), afterMs);
}

function createHost(options: OpenHostOptions): Promise<HostPeer> {
  const { preferredCode, retainMs = RETAIN_MS } = options;
  const startedAt = Date.now();

  return new Promise((resolve, jilt) => {
    let attempt = 0;
    /** Counted apart from `attempt` so fighting for our own id can't bail out. */
    let idClashes = 0;
    /** Makes every locally-minted connection id unique within this room. */
    let connections = 0;

    const tryOpen = (code: string): void => {
      attempt++;
      const peer = new Peer(roomPeerId(code), { config: ICE_CONFIG });
      let settled = false;
      let opened = false;

      let onConnectCb: ((channel: Channel) => void) | null = null;
      let onBrokerCb: ((state: BrokerState) => void) | null = null;
      let brokerState: BrokerState = 'UP';

      const loop = makeBrokerLoop({
        reconnect: () => peer.reconnect(),
        isDead: () => peer.destroyed,
        isDisconnected: () => peer.disconnected,
        isOpen: () => peer.open,
        now: () => Date.now(),
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => window.clearTimeout(id),
        onState: (state) => {
          brokerState = state;
          onBrokerCb?.(state);
        },
      });

      // A quiet broker leaves this pending and the lobby stuck on "opening a
      // room" with nothing to say why.
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        loop.stop();
        peer.destroy();
        jilt(new ConnectError('TIMEOUT', 'could not reach the room service'));
      }, HOST_CONNECT_TIMEOUT_MS);

      peer.on('open', () => {
        window.clearTimeout(timer);
        loop.up();
        // A reconnect re-emits 'open'. Registering 'connection' again would
        // wrap every guest twice and process every message twice — two votes
        // from one tap. This guard is the only thing preventing that, and it
        // matters precisely because reconnecting now works.
        if (opened) return;
        opened = true;
        settled = true;

        peer.on('disconnected', () => loop.down());
        peer.on('connection', (conn) => {
          // The id is minted here, not taken from the connection. See `wrap`:
          // the guest chooses `conn.connectionId`, and everything on the host
          // side that asks "which player is this" keys off it.
          const id = `conn-${++connections}-${Math.random().toString(36).slice(2)}`;
          let negotiated = false;
          const giveUp = window.setTimeout(() => {
            if (negotiated) return;
            // Never opened, so nothing downstream knows it exists and nothing
            // will ever close it. Safe on a connection that never negotiated:
            // `close()` on one that is not open tears down the negotiator and
            // emits nothing.
            try {
              conn.close();
            } catch {
              /* already gone */
            }
          }, INCOMING_OPEN_TIMEOUT_MS);
          conn.on('open', () => {
            negotiated = true;
            window.clearTimeout(giveUp);
            onConnectCb?.(wrap(conn as unknown as RawConn, id));
          });
        });

        resolve({
          code,
          onConnect: (cb) => {
            onConnectCb = cb;
          },
          onBroker: (cb) => {
            onBrokerCb = cb;
            cb(brokerState);
          },
          reconnect: () => {
            // Nothing happens to a healthy peer. This is called on every tab
            // resume, and an unconditional `loop.down()` here meant every
            // return from a locked phone lit the "reconnecting" banner and
            // hid the room code — for a socket that was never down.
            //
            // `reconnect()` throws both on a destroyed peer and on one that is
            // not disconnected, so the guard is load-bearing twice over.
            if (!peer.disconnected || peer.destroyed) return;
            try {
              peer.reconnect();
            } catch {
              /* raced */
            }
            // iOS delivers the socket's `close` on resume, after
            // `visibilitychange` has been and gone; arming the loop is what
            // covers the gap if that `reconnect()` does not take.
            loop.down();
          },
          destroy: () => {
            // Before `peer.destroy()`, which emits 'disconnected' on its way
            // out and would otherwise arm the loop against a corpse.
            loop.stop();
            peer.destroy();
          },
        });
      });

      peer.on('error', (err: Error & { type?: string }) => {
        if (opened) {
          // Post-open errors are recoverable signalling trouble, not a reason
          // to tear the room down. `_abort` reports the same failure as both
          // an error and a disconnect; the loop dedupes that.
          //
          // But only the socket-shaped ones. `peer-unavailable`,
          // `webrtc` and friends fire for a single guest's failed handshake
          // and say nothing about the broker — treating those as an outage
          // put the whole room on the degraded banner because one phone in
          // the corner could not negotiate ICE.
          if (isBrokerError(err.type)) loop.down();
          return;
        }
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        loop.stop();
        peer.destroy();

        if (err.type !== 'unavailable-id') {
          jilt(new ConnectError('NETWORK', String(err)));
          return;
        }

        // Somebody — very likely our own previous tab — still holds this id.
        // peerjs-server keeps an abandoned one for about a minute.
        const resuming = preferredCode === code;
        if (resuming && Date.now() - startedAt < retainMs) {
          idClashes++;
          setTimeout(() => tryOpen(code), RETRY_STEP_MS);
          return;
        }
        if (resuming) {
          // Deliberately NOT falling back to a fresh code. Every guest is
          // dialling the old one and the shared QR points at it; swapping the
          // number silently would strand the whole room.
          jilt(new ConnectError('CODE_LOST', 'the room code could not be reclaimed'));
          return;
        }
        if (attempt - idClashes >= 6) {
          jilt(new ConnectError('NETWORK', 'could not open a room'));
          return;
        }
        tryOpen(randomCode());
      });
    };

    tryOpen(preferredCode ?? randomCode());
  });
}

/**
 * The guest's side of the handshake, with the same one-per-tab rule and for
 * the same reason: two StrictMode mounts would open two channels, and the host
 * would see two connections claiming one name.
 */
type GuestEntry = {
  code: string;
  promise: Promise<GuestPeer>;
  peer: GuestPeer | null;
  dead: boolean;
};

let joined: GuestEntry | null = null;

export function joinHost(code: string): Promise<GuestPeer> {
  if (joined && joined.code === code && joined.peer?.channel.isOpen() !== false) {
    return joined.promise;
  }
  // Whatever we are replacing has to go. Every reconnect lands here, and an
  // orphaned Peer keeps a broker websocket open plus a closure that will call
  // setState on an unmounted tree — across a long evening on a flaky phone that
  // adds up. `dead` covers the one still mid-dial, which has no `peer` to kill
  // yet and would otherwise survive as a second connection to the same host.
  retire(joined);
  const promise = createGuest(code);
  const entry: GuestEntry = { code, promise, peer: null, dead: false };
  joined = entry;
  promise.then(
    (peer) => {
      entry.peer = peer;
      if (entry.dead) peer.destroy();
    },
    () => {
      if (joined === entry) joined = null;
    },
  );
  return promise;
}

function retire(entry: GuestEntry | null): void {
  if (!entry) return;
  entry.dead = true;
  entry.peer?.destroy();
}

export function destroyGuest(): void {
  const entry = joined;
  joined = null;
  retire(entry);
}

function createGuest(code: string): Promise<GuestPeer> {
  return new Promise((resolve, jilt) => {
    // An explicit id, so PeerJS skips its HTTPS id fetch — see `guestPeerId`.
    const peer = new Peer(guestPeerId(), { config: ICE_CONFIG });
    let settled = false;

    const fail = (kind: ConnectFailure, message: string): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      peer.destroy();
      jilt(new ConnectError(kind, message));
    };

    const timer = window.setTimeout(
      () => fail('TIMEOUT', 'connection timed out'),
      GUEST_CONNECT_TIMEOUT_MS,
    );

    peer.on('open', () => {
      const conn = peer.connect(roomPeerId(code), { reliable: true });
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve({ channel: wrap(conn as unknown as RawConn), destroy: () => peer.destroy() });
      });
      conn.on('error', (err) => fail('NETWORK', String(err)));
    });

    peer.on('error', (err: Error & { type?: string }) => {
      // The broker answering "nobody is listening on that id" is the single
      // most useful thing it ever says: the code is wrong, or the room is gone.
      // Retrying it is pointless and telling the player to wait is a lie.
      fail(err.type === 'peer-unavailable' ? 'NO_ROOM' : 'NETWORK', String(err));
    });
  });
}
