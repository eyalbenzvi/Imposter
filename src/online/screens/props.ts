import type { Intent } from '../protocol';
import type { PlayerView } from '../view';

/**
 * Every online game screen takes the same two things and nothing else: what
 * this player may see, and a way to say what they want. The host renders these
 * with a local `send`; a guest renders them with one that goes over the wire.
 * Neither can tell the difference, which is the point.
 */
export type Send = (msg: Intent) => void;

export type GameScreenProps = {
  view: PlayerView;
  send: Send;
};
