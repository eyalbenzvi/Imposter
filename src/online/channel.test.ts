import { describe, expect, it, vi } from 'vitest';
import { wrap, type RawConn } from './channel';

/**
 * A `DataConnection` with the handful of members `wrap` touches, and a lever
 * for every way a real one can end: gracefully, abruptly, or by going silent
 * and never emitting anything at all.
 *
 * The last one is the whole reason this exists. It is the failure that actually
 * happens at a party — a phone locks, a tab is killed, wifi drops — and it is
 * the one no test could reach while `wrap` lived inside the peerjs import.
 */
function fakeConn(): RawConn & {
  /** The far side closed cleanly. */
  remoteClose(): void;
  /** Something went wrong on the wire. */
  remoteError(): void;
  deliver(data: unknown): void;
  closeCalls: { flush?: boolean }[];
  sent: unknown[];
} {
  const handlers: Record<string, ((arg?: unknown) => void)[]> = {};
  const closeCalls: { flush?: boolean }[] = [];
  const sent: unknown[] = [];
  const conn = {
    connectionId: 'c1',
    open: true,
    on(event: string, cb: (arg?: unknown) => void) {
      (handlers[event] ??= []).push(cb);
    },
    send(msg: unknown) {
      sent.push(msg);
    },
    close(options?: { flush?: boolean }) {
      closeCalls.push(options ?? {});
      // The real thing emits 'close' synchronously — and only when it was still
      // open. Both halves matter to the machine under test.
      if (!conn.open) return;
      if (!options?.flush) conn.open = false;
      for (const cb of handlers.close ?? []) cb();
    },
    remoteClose() {
      conn.open = false;
      for (const cb of handlers.close ?? []) cb();
    },
    remoteError() {
      for (const cb of handlers.error ?? []) cb(new Error('boom'));
    },
    deliver(data: unknown) {
      for (const cb of handlers.data ?? []) cb(data);
    },
    closeCalls,
    sent,
  };
  return conn;
}

describe('who gets told the channel ended', () => {
  /**
   * The bug this pins down: `close()` used to set the same flag `fire()` checks,
   * and `DataConnection.close()` emits synchronously — so the close we asked
   * for swallowed its own event. The guest's silence detector calls `close()`
   * *in order to* start a reconnect, and instead froze the screen for good.
   */
  it('stays silent when we close it ourselves', () => {
    const conn = fakeConn();
    const channel = wrap(conn);
    const onClose = vi.fn();
    channel.onClose(onClose);

    channel.close();

    expect(conn.closeCalls).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(channel.isOpen()).toBe(false);
  });

  it('tells the owner when we drop it', () => {
    const conn = fakeConn();
    const channel = wrap(conn);
    const onClose = vi.fn();
    channel.onClose(onClose);

    channel.drop();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(channel.isOpen()).toBe(false);
  });

  /**
   * `conn.close()` returns early without emitting when the connection is
   * already down, so a `drop()` that leaned on the event would lose exactly the
   * case it exists for.
   */
  it('tells the owner even when the connection has already gone', () => {
    const conn = fakeConn();
    const channel = wrap(conn);
    const onClose = vi.fn();
    channel.onClose(onClose);
    conn.open = false;

    channel.drop();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tells the owner when the far side closes', () => {
    const conn = fakeConn();
    const channel = wrap(conn);
    const onClose = vi.fn();
    channel.onClose(onClose);

    conn.remoteClose();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(channel.isOpen()).toBe(false);
  });

  it('tells the owner once, however many ways it ends', () => {
    const conn = fakeConn();
    const channel = wrap(conn);
    const onClose = vi.fn();
    channel.onClose(onClose);

    conn.remoteError();
    conn.remoteClose();
    channel.drop();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * A close can land between `wrap()` and the owner registering — the guest
   * would otherwise wait on an event that has already been and gone.
   */
  it('replays a remote close to a listener that arrives late', () => {
    const conn = fakeConn();
    const channel = wrap(conn);
    conn.remoteClose();

    const onClose = vi.fn();
    channel.onClose(onClose);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * …but only a *remote* one. Replaying our own silent close would put back the
   * double-commit that keeping the host on `close()` avoids.
   */
  it('does not replay a close we made ourselves', () => {
    const conn = fakeConn();
    const channel = wrap(conn);
    channel.close();

    const onClose = vi.fn();
    channel.onClose(onClose);

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('graceful close', () => {
  it('asks the far side to close and stops sending', () => {
    const conn = fakeConn();
    const channel = wrap(conn);
    const onClose = vi.fn();
    channel.onClose(onClose);

    channel.closeGracefully();

    expect(conn.closeCalls).toEqual([{ flush: true }]);
    expect(onClose).not.toHaveBeenCalled();
    // The local connection is still up — `flush` only sends a marker — but the
    // wrapper is done with it, so nothing else queues behind the last message.
    expect(channel.isOpen()).toBe(false);
    channel.send({ t: 'PING' });
    expect(conn.sent).toHaveLength(0);
  });
});

describe('messages', () => {
  it('passes objects through and parses strings', () => {
    const conn = fakeConn();
    const channel = wrap(conn);
    const seen: unknown[] = [];
    channel.onMessage((m) => seen.push(m));

    conn.deliver({ t: 'PING' });
    conn.deliver(JSON.stringify({ t: 'LEAVE' }));

    expect(seen).toEqual([{ t: 'PING' }, { t: 'LEAVE' }]);
  });

  it('drops anything that is not valid JSON rather than throwing', () => {
    const conn = fakeConn();
    const channel = wrap(conn);
    const seen: unknown[] = [];
    channel.onMessage((m) => seen.push(m));

    conn.deliver('{ not json');

    expect(seen).toEqual([]);
  });

  it('registers one listener, not a pile of them', () => {
    // A StrictMode remount hands the same channel to a second effect. Two live
    // handlers means every message is processed twice — two seats for one
    // guest, two votes from one tap.
    const conn = fakeConn();
    const channel = wrap(conn);
    const first = vi.fn();
    const second = vi.fn();
    channel.onMessage(first);
    channel.onMessage(second);

    conn.deliver({ t: 'PING' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not send once the connection is down', () => {
    const conn = fakeConn();
    const channel = wrap(conn);
    conn.remoteClose();
    channel.send({ t: 'PING' });
    expect(conn.sent).toHaveLength(0);
  });
});
