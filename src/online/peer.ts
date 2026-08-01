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

export function roomPeerId(code: string): string {
  return `${PEER_PREFIX}${code}`;
}

/** Four digits: short enough to read across a room, and that is the point. */
export function randomCode(): string {
  const n = Math.floor(Math.random() * 9000) + 1000;
  return String(n);
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

      peer.on('open', () => {
        settled = true;
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
        peer.destroy();
        if (err.type !== 'unavailable-id') {
          jilt(err);
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
          jilt(new Error('could not open a room'));
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

    peer.on('open', () => {
      const conn = peer.connect(roomPeerId(code), { reliable: true });
      conn.on('open', () => {
        settled = true;
        resolve({ channel: wrap(conn), destroy: () => peer.destroy() });
      });
      conn.on('error', (err) => {
        if (settled) return;
        settled = true;
        peer.destroy();
        jilt(err);
      });
    });

    peer.on('error', (err) => {
      if (settled) return;
      settled = true;
      peer.destroy();
      jilt(err);
    });
  });
}
