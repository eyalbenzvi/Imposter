import { describe, expect, it } from 'vitest';
import { ROOM_CODE_LENGTH } from './protocol';
import {
  GUEST_CONNECT_TIMEOUT_MS,
  HOST_CONNECT_TIMEOUT_MS,
  ICE_CONFIG,
  INCOMING_OPEN_TIMEOUT_MS,
  PEER_ID_PATTERN,
  guestPeerId,
  randomCode,
  roomPeerId,
} from './peerIds';

/**
 * Everything here fails the same way: nobody connects, and nothing says why.
 *
 * A peer id the broker refuses, or an ICE entry the `RTCPeerConnection`
 * constructor rejects, both surface as an ordinary connection timeout from
 * somewhere deep inside PeerJS. There is no error to read and no way to notice
 * short of nobody being able to play. So these values are pinned.
 */

describe('peer ids', () => {
  it('gives every guest an id the broker will accept', () => {
    for (let i = 0; i < 500; i++) {
      const id = guestPeerId();
      expect(PEER_ID_PATTERN.test(id), id).toBe(true);
    }
  });

  it('gives every room an id the broker will accept', () => {
    for (let i = 0; i < 200; i++) {
      const id = roomPeerId(randomCode());
      expect(PEER_ID_PATTERN.test(id), id).toBe(true);
    }
  });

  /**
   * The prefix is what keeps this game's ids out of every other PeerJS app's
   * way on the shared public broker.
   */
  it('namespaces both kinds under the same prefix', () => {
    expect(guestPeerId().startsWith('imposter-v1-')).toBe(true);
    expect(roomPeerId('123456')).toBe('imposter-v1-123456');
  });

  it('does not draw the same guest id twice', () => {
    const seen = new Set(Array.from({ length: 2_000 }, guestPeerId));
    expect(seen.size).toBe(2_000);
  });

  it('draws room codes of the length the join screen accepts', () => {
    for (let i = 0; i < 500; i++) {
      const code = randomCode();
      expect(code).toMatch(/^\d+$/);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
    }
  });

  /**
   * A guest id must never be mistakable for a room id, or a guest could be
   * dialled into as though it were a room.
   */
  it('cannot be confused with a room code', () => {
    const suffix = guestPeerId().slice('imposter-v1-'.length);
    expect(suffix.startsWith('g-')).toBe(true);
    expect(suffix).not.toMatch(/^\d+$/);
  });
});

describe('the ICE configuration', () => {
  /**
   * Supplying `config` *replaces* PeerJS's default rather than merging with it,
   * so anything the default carried and this does not is simply lost.
   */
  it('keeps everything PeerJS’s own default provides', () => {
    const urls = ICE_CONFIG.iceServers.flatMap((s) => s.urls);
    expect(urls).toContain('stun:stun.l.google.com:19302');
    expect(urls).toContain('turn:eu-0.turn.peerjs.com:3478');
    expect(urls).toContain('turn:us-0.turn.peerjs.com:3478');
    expect(ICE_CONFIG.sdpSemantics).toBe('unified-plan');
  });

  /** Without both, the constructor throws `InvalidAccessError` on a TURN URL. */
  it('gives every TURN entry a username and a credential', () => {
    for (const server of ICE_CONFIG.iceServers) {
      const needsAuth = server.urls.some((u) => u.startsWith('turn'));
      if (!needsAuth) continue;
      expect(server.username, JSON.stringify(server.urls)).toBeTruthy();
      expect(server.credential, JSON.stringify(server.urls)).toBeTruthy();
    }
  });

  /** A single STUN host is a single point of failure during gathering. */
  it('has more than one way to learn its own address', () => {
    const stun = ICE_CONFIG.iceServers.flatMap((s) =>
      s.urls.filter((u) => u.startsWith('stun:')),
    );
    expect(stun.length).toBeGreaterThan(1);
  });

  it('has no empty or malformed entry', () => {
    expect(ICE_CONFIG.iceServers.length).toBeGreaterThan(0);
    for (const server of ICE_CONFIG.iceServers) {
      expect(server.urls.length).toBeGreaterThan(0);
      for (const url of server.urls) {
        expect(url, url).toMatch(/^(stun|turn|turns):[A-Za-z0-9.-]+:\d+(\?transport=(tcp|udp))?$/);
      }
    }
  });
});

describe('the connection timeouts', () => {
  /**
   * The host hangs up on an incoming connection that never negotiates. If that
   * clock were shorter than the guest's own, it would be cutting off attempts
   * that were still going to succeed — and the guest would see an ordinary
   * failure with no way to tell that the host had hung up on it.
   */
  it('never hangs up before the guest has given up itself', () => {
    expect(INCOMING_OPEN_TIMEOUT_MS).toBeGreaterThan(GUEST_CONNECT_TIMEOUT_MS);
  });

  /**
   * The guest needs longer than the host: the host only has to reach the
   * broker, the guest has to reach it *and* complete a whole ICE negotiation.
   */
  it('gives the guest longer than the host, because it does more', () => {
    expect(GUEST_CONNECT_TIMEOUT_MS).toBeGreaterThan(HOST_CONNECT_TIMEOUT_MS);
  });

  /**
   * The broker answers "there is no such room" by expiring the queued offer,
   * which takes around five seconds. A shorter budget races that and reports a
   * mistyped code as "we could not connect" — which is not only wrong, it is
   * classified differently and leaves the dead session on disk.
   */
  it('outlasts the broker’s own answer for a room that is not there', () => {
    expect(GUEST_CONNECT_TIMEOUT_MS).toBeGreaterThan(10_000);
  });
});
