/**
 * A data channel, and the small state machine that decides when its owner is
 * told it has gone.
 *
 * Deliberately free of any `peerjs` import: everything here works against
 * `RawConn`, the handful of members a `DataConnection` actually exposes to us.
 * That is what lets the machine below be tested in Node against a hand-made
 * connection — and it is the machine, not the wiring, where the bugs were.
 *
 * ── Why three flags and not one ──────────────────────────────────────────
 *
 * `DataConnection.close()` emits `'close'` **synchronously**. A single "closed"
 * flag set before calling it therefore swallows the very event it is guarding,
 * so `onClose` never fires for a close we initiated. That is not a theoretical
 * tidiness point: the guest's silence detector calls `close()` precisely in
 * order to trigger its own reconnect, and with one flag the reconnect never
 * happens and the screen freezes for good.
 *
 * The obvious repair — one flag, set in both paths — puts a different bug in
 * its place: a late `onClose` registration then fires immediately for a close
 * we made on purpose, and the host's sweep double-commits. So the two questions
 * are kept apart:
 *
 *   silenced — we closed it. The owner must NOT be told.
 *   fired    — the owner has been told (or is being told right now).
 *   pending  — it closed before anyone was listening; tell them on arrival.
 */

export type Channel = {
  id: string;
  send(msg: unknown): void;
  /** We are closing it. Silent: `onClose` will not fire. */
  close(): void;
  /**
   * Ask the far side to close, leaving the local side up long enough for
   * anything already queued to leave. Also silent.
   *
   * This does NOT wait for the buffer to drain — `flush` only sends a marker
   * that makes the far end close cleanly. Draining is the caller's problem,
   * and the caller solves it by waiting before it destroys the peer.
   */
  closeGracefully(): void;
  /** The far side has gone. Tear down AND tell the owner. */
  drop(): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  isOpen(): boolean;
};

/** The parts of a PeerJS `DataConnection` this module relies on. */
export type RawConn = {
  connectionId: string;
  open: boolean;
  on(event: 'data' | 'close' | 'error', cb: (arg?: unknown) => void): void;
  send(msg: unknown): void;
  close(options?: { flush?: boolean }): void;
};

/**
 * @param id Overrides `conn.connectionId`, which the **connecting** side chose.
 *
 * PeerJS lets a caller pass `{ connectionId }` to `peer.connect()`, puts it in
 * the offer, and the answering side adopts it verbatim. So on the host,
 * `conn.connectionId` is a string the guest picked — and this app keys seats,
 * the channel table and `lastSeen` on it. A guest who names itself `'host'`
 * lands on the host's own seat. Anywhere the id decides *who somebody is*, it
 * has to be minted locally.
 */
export function wrap(conn: RawConn, id: string = conn.connectionId): Channel {
  let onMessageCb: ((msg: unknown) => void) | null = null;
  let onCloseCb: (() => void) | null = null;

  let silenced = false;
  let fired = false;
  let pending = false;

  conn.on('data', (data) => {
    // Everything crosses as JSON; a string is what a slightly different peerjs
    // build might hand us instead of a parsed object.
    const msg = typeof data === 'string' ? safeParse(data) : data;
    if (msg !== undefined) onMessageCb?.(msg);
  });

  const fire = (): void => {
    if (fired || silenced) return;
    fired = true;
    if (onCloseCb) onCloseCb();
    else pending = true;
  };

  conn.on('close', fire);
  conn.on('error', fire);

  const shut = (options?: { flush?: boolean }): void => {
    try {
      conn.close(options);
    } catch {
      /* already gone */
    }
  };

  return {
    id,

    send(msg) {
      if (silenced || fired || !conn.open) return;
      try {
        conn.send(msg);
      } catch {
        // A channel that dies mid-send is handled by the close handler; a
        // throw here must not take the host's render down with it.
      }
    },

    close() {
      silenced = true;
      fired = true;
      shut();
    },

    closeGracefully() {
      silenced = true;
      fired = true;
      shut({ flush: true });
    },

    drop() {
      // No flag is set first, and `fire()` is called explicitly: `conn.close()`
      // returns early without emitting when the connection is already down, so
      // relying on the event would lose exactly the case this exists for.
      shut();
      fire();
    },

    onMessage(cb) {
      onMessageCb = cb;
    },

    onClose(cb) {
      onCloseCb = cb;
      // A close that landed between `wrap()` and this registration would
      // otherwise be lost forever, leaving the guest waiting on an event that
      // has already been and gone.
      if (pending) {
        pending = false;
        cb();
      }
    },

    isOpen: () => !silenced && !fired && conn.open,
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
