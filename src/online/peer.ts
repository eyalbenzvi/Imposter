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

import Peer, { type DataConnection } from 'peerjs';
import { PEER_PREFIX } from './protocol';

export type Channel = {
  id: string;
  send(msg: unknown): void;
  close(): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  isOpen(): boolean;
};

/**
 * Why a connection attempt failed, in the only three flavours that change what
 * a player should be told or what the app should do next.
 *
 * PeerJS reports "there is no such peer" and "the broker is not answering" as
 * ordinary errors, and without telling them apart the app can only shrug and
 * retry — which is precisely what left a phone re-dialling a room that had
 * been closed hours earlier, forever, with nothing on screen to say so.
 */
export type ConnectFailure = 'NO_ROOM' | 'TIMEOUT' | 'NETWORK';

export class ConnectError extends Error {
  readonly kind: ConnectFailure;
  constructor(kind: ConnectFailure, message: string) {
    super(message);
    this.name = 'ConnectError';
    this.kind = kind;
  }
}

/**
 * How long to wait before calling it.
 *
 * Nothing in PeerJS times out on its own: a broker that accepts the socket and
 * then goes quiet, or an ICE negotiation that never completes, leaves the
 * promise pending for the lifetime of the tab. Every hang reported so far was
 * this.
 */
const CONNECT_TIMEOUT_MS = 6_000;

export function roomPeerId(code: string): string {
  return `${PEER_PREFIX}${code}`;
}

/**
 * Six digits: short enough to read across a room, long enough not to collide.
 *
 * The peer id lives in a namespace shared with every other copy of this game on
 * the public broker, so a code is not just a convenience — two groups drawing
 * the same one means the second host cannot open their room and a guest who
 * types it lands in a stranger's game. Four digits is 9,000 slots and starts
 * colliding at around a hundred concurrent rooms; six is 900,000.
 */
export function randomCode(): string {
  return String(Math.floor(Math.random() * 900_000) + 100_000);
}

/**
 * A channel has exactly one listener for each event, and registering a new one
 * replaces the old.
 *
 * Appending would look more flexible and would be wrong: a StrictMode remount
 * hands the same channel back to a second effect, and two live handlers means
 * every message is processed twice — two seats claimed for one guest, two votes
 * from one tap.
 */
function wrap(conn: DataConnection): Channel {
  let onMessageCb: ((msg: unknown) => void) | null = null;
  let onCloseCb: (() => void) | null = null;
  let closed = false;

  conn.on('data', (data) => {
    // Everything crosses as JSON; a string is what a slightly different peerjs
    // build might hand us instead of a parsed object.
    const msg = typeof data === 'string' ? safeParse(data) : data;
    if (msg !== undefined) onMessageCb?.(msg);
  });

  const fire = () => {
    if (closed) return;
    closed = true;
    onCloseCb?.();
  };
  conn.on('close', fire);
  conn.on('error', fire);

  return {
    id: conn.connectionId,
    send(msg) {
      if (closed || !conn.open) return;
      try {
        conn.send(msg);
      } catch {
        // A channel that dies mid-send is handled by the close handler; a
        // throw here must not take the host's render down with it.
      }
    },
    close() {
      closed = true;
      try {
        conn.close();
      } catch {
        /* already gone */
      }
    },
    onMessage(cb) {
      onMessageCb = cb;
    },
    onClose(cb) {
      onCloseCb = cb;
    },
    isOpen: () => !closed && conn.open,
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export type HostPeer = {
  code: string;
  /** Replaces the handler rather than adding one — see the singleton note. */
  onConnect(cb: (channel: Channel) => void): void;
  /** Nudge the broker after the tab has been backgrounded. */
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

const RETAIN_MS = 45_000;
const RETRY_STEP_MS = 1_500;

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
let live: { promise: Promise<HostPeer>; peer: HostPeer | null } | null = null;

export function openHost(options: OpenHostOptions = {}): Promise<HostPeer> {
  if (live) return live.promise;
  const promise = createHost(options);
  const entry: { promise: Promise<HostPeer>; peer: HostPeer | null } = {
    promise,
    peer: null,
  };
  live = entry;
  promise.then(
    (peer) => {
      entry.peer = peer;
    },
    () => {
      if (live === entry) live = null;
    },
  );
  return promise;
}

/** The real teardown. Only `closeRoom` calls this, never an effect cleanup. */
export function destroyHost(): void {
  const entry = live;
  live = null;
  entry?.peer?.destroy();
}

function createHost(options: OpenHostOptions): Promise<HostPeer> {
  const { preferredCode, retainMs = RETAIN_MS } = options;
  const startedAt = Date.now();

  return new Promise((resolve, jilt) => {
    let attempt = 0;

    const tryOpen = (code: string): void => {
      attempt++;
      const peer = new Peer(roomPeerId(code));
      let settled = false;

      // Same hazard as the guest side: a quiet broker leaves this pending and
      // the lobby stuck on "opening a room" with no way to tell why.
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        peer.destroy();
        jilt(new ConnectError('TIMEOUT', 'could not reach the room service'));
      }, CONNECT_TIMEOUT_MS);

      peer.on('open', () => {
        settled = true;
        window.clearTimeout(timer);
        // One handler, replaced on each mount: a StrictMode remount must not
        // leave the previous mount's callback wired to the same peer, or every
        // guest would be processed twice.
        let onConnectCb: ((channel: Channel) => void) | null = null;
        peer.on('connection', (conn) => {
          conn.on('open', () => onConnectCb?.(wrap(conn)));
        });
        resolve({
          code,
          onConnect: (cb) => {
            onConnectCb = cb;
          },
          reconnect: () => {
            if (peer.disconnected && !peer.destroyed) peer.reconnect();
          },
          destroy: () => peer.destroy(),
        });
      });

      peer.on('error', (err: Error & { type?: string }) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        peer.destroy();
        if (err.type !== 'unavailable-id') {
          jilt(new ConnectError('NETWORK', String(err)));
          return;
        }
        // Somebody — very likely our own previous tab — still holds this id.
        const keepFighting =
          preferredCode === code && Date.now() - startedAt < retainMs;
        if (keepFighting) {
          setTimeout(() => tryOpen(code), RETRY_STEP_MS);
          return;
        }
        if (attempt >= 6) {
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
 * The guest's side of the handshake, with the same one-per-tab rule and for the
 * same reason: two StrictMode mounts would open two channels, the host would
 * see two different connections claiming one name, and the second would be
 * turned away as a duplicate.
 */
let joined: { code: string; promise: Promise<GuestPeer>; peer: GuestPeer | null } | null =
  null;

export type GuestPeer = { channel: Channel; destroy(): void };

export function joinHost(code: string): Promise<GuestPeer> {
  if (joined && joined.code === code && joined.peer?.channel.isOpen() !== false) {
    return joined.promise;
  }
  // Whatever we are replacing has to go. Every reconnect lands here, and an
  // orphaned Peer keeps a broker websocket open plus a closure that will call
  // setState on an unmounted tree — across a long evening on a flaky phone that
  // adds up.
  joined?.peer?.destroy();
  const promise = createGuest(code);
  const entry: { code: string; promise: Promise<GuestPeer>; peer: GuestPeer | null } = {
    code,
    promise,
    peer: null,
  };
  joined = entry;
  promise.then(
    (peer) => {
      entry.peer = peer;
    },
    () => {
      if (joined === entry) joined = null;
    },
  );
  return promise;
}

export function destroyGuest(): void {
  const entry = joined;
  joined = null;
  entry?.peer?.destroy();
}

function createGuest(code: string): Promise<GuestPeer> {
  return new Promise((resolve, jilt) => {
    // An undefined id makes the broker mint one; guests do not need a stable
    // identity, their seat is the identity.
    const peer = new Peer();
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
      CONNECT_TIMEOUT_MS,
    );

    peer.on('open', () => {
      const conn = peer.connect(roomPeerId(code), { reliable: true });
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve({ channel: wrap(conn), destroy: () => peer.destroy() });
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
