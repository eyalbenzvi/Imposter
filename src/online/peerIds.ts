/**
 * Peer identities and ICE configuration — the parts of the PeerJS setup that
 * are plain data.
 *
 * Split out of `peer.ts` for one reason: `peer.ts` imports `peerjs`, which is a
 * browser library and cannot be loaded in Node. Everything here can be, and
 * every value in this file is one where being wrong means *nobody connects at
 * all* — a malformed peer id is rejected by the broker, a malformed ICE entry
 * throws from the `RTCPeerConnection` constructor. Those deserve tests, and
 * this is what makes them testable.
 */

import { PEER_PREFIX } from './protocol';

/**
 * PeerJS's own id validator, copied verbatim from its source.
 *
 * Alphanumeric runs joined by single spaces, underscores or hyphens. An id that
 * fails this is refused by the broker, so a mistake here is not subtle — it is
 * every guest, every time.
 */
export const PEER_ID_PATTERN = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;

/**
 * ICE servers, pinned rather than inherited.
 *
 * Reproduces PeerJS's own default — including `sdpSemantics`, because supplying
 * `config` replaces the default wholesale rather than merging with it — and
 * adds a second STUN server. One STUN host is a single point of failure during
 * gathering: where it is slow or blocked there is no other source of a
 * reflexive candidate, and the connect timeout simply runs out.
 *
 * Pinning it also means a PeerJS upgrade cannot change the relay strategy
 * underneath us.
 *
 * Deliberately *not* added: `?transport=tcp` variants of the TURN URLs. They
 * would help on networks that block outbound UDP, which is exactly where a
 * relay is most needed — but a malformed ICE entry throws from the
 * `RTCPeerConnection` constructor, deep inside PeerJS, where it surfaces as an
 * ordinary timeout with nothing in the log. There is no way to verify those
 * hosts answer on TCP without real devices on such a network, and the cost of
 * being wrong is that nobody can connect at all.
 */
export const ICE_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    {
      urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
      username: 'peerjs',
      credential: 'peerjsp',
    },
  ],
  sdpSemantics: 'unified-plan',
};

export function roomPeerId(code: string): string {
  return `${PEER_PREFIX}${code}`;
}

/**
 * Six digits: short enough to read across a room, long enough not to collide.
 *
 * The peer id lives in a namespace shared with every other copy of this game on
 * the public broker, so a code is not just a convenience — two groups drawing
 * the same one means the second host cannot open their room and a guest who
 * types it lands in a stranger's game.
 */
export function randomCode(): string {
  return String(Math.floor(Math.random() * 900_000) + 100_000);
}

/**
 * A peer id for a guest.
 *
 * Guests do not need a stable identity — their seat is their identity — but
 * they do need *an* id, because `new Peer()` with none makes PeerJS fetch one
 * over HTTPS from the broker before it even opens its WebSocket. That is a
 * whole extra TLS handshake and round trip on the front of every dial and every
 * reconnect, inside a budget that also has to cover the entire ICE negotiation.
 *
 * `Math.random()` rather than `crypto.randomUUID`, which is absent outside a
 * secure context and on older iOS — where it would throw inside a promise
 * executor and lock that phone out of every room, permanently.
 */
export function guestPeerId(): string {
  const rand = (): string => Math.random().toString(36).slice(2, 10);
  return `${PEER_PREFIX}g-${rand()}${rand()}`;
}
