/**
 * Online persistence, under a key of its own.
 *
 * Deliberately NOT `src/ui/storage.ts`. Writing an online game into the
 * single-device key would restore a mid-game state the next time somebody
 * opened the app on their own — walking whoever holds the phone through every
 * player's reveal card, which hands them the secret word and, by comparison,
 * the imposter. The two modes share a reducer; they must not share a slot.
 */

import type { Settings } from '../game/types';
import type { Room, Seat } from './room';
import { ROOM_CODE_LENGTH, type SeatId } from './protocol';

const KEY = 'imposter/online/v1';

/** A party is over long before this; a stale room must not resurrect itself. */
const TTL_MS = 6 * 60 * 60 * 1000;

export type HostSession = {
  code: string;
  seats: Seat[];
  /**
   * The frozen seat→player map. Without this a host who refreshes rebuilds
   * seats from whatever order the guests happen to reconnect in, and every
   * player is handed somebody else's word.
   */
  seatOrder: SeatId[] | null;
  locked: boolean;
  settings: Settings;
  state: Room['state'];
  epoch: number;
  at: number;
};

export type GuestSession = {
  code: string;
  seatId: SeatId;
  name: string;
  /**
   * The secret that proves the seat is ours. Absent in sessions written by
   * builds before seats had one — those simply cannot reclaim a seat, which
   * costs a rejoin and nothing else.
   */
  token?: string;
  at: number;
};

type Saved = { host?: HostSession; guest?: GuestSession };

function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : {};
  } catch {
    return {};
  }
}

function write(value: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Private-mode with no quota is not a reason to break the game.
  }
}

function fresh<T extends { at: number }>(value: T | undefined): T | null {
  if (!value || typeof value.at !== 'number') return null;
  return Date.now() - value.at < TTL_MS ? value : null;
}

export function loadHostSession(): HostSession | null {
  const host = fresh(read().host);
  if (!host || typeof host.code !== 'string' || !host.state) return null;
  return host;
}

export function saveHostSession(room: Room): void {
  const saved = read();
  write({
    ...saved,
    host: {
      code: room.code,
      // Live connection ids mean nothing after a reload.
      seats: room.seats.map((s) => ({ ...s, connId: s.isHost ? 'host' : null })),
      seatOrder: room.seatOrder,
      locked: room.locked,
      settings: room.settings,
      state: room.state,
      epoch: room.epoch,
      at: Date.now(),
    },
  });
}

export function clearHostSession(): void {
  const saved = read();
  delete saved.host;
  write(saved);
}

export function loadGuestSession(code?: string): GuestSession | null {
  const guest = fresh(read().guest);
  if (!guest || typeof guest.seatId !== 'string') return null;
  // A seat only means anything in the room it was issued for.
  if (code !== undefined && guest.code !== code) return null;
  return guest;
}

export function saveGuestSession(session: Omit<GuestSession, 'at'>): void {
  const saved = read();
  write({ ...saved, guest: { ...session, at: Date.now() } });
}

export function clearGuestSession(): void {
  const saved = read();
  delete saved.guest;
  write(saved);
}

/** `#join=123456` in the address bar, from a shared link. */
export function readJoinCode(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.hash.match(
    new RegExp(`join=(\\d{${ROOM_CODE_LENGTH}})(?!\\d)`),
  );
  return match ? match[1]! : null;
}

export function clearJoinCode(): void {
  if (typeof window === 'undefined') return;
  if (!window.location.hash.includes('join=')) return;
  const url = new URL(window.location.href);
  url.hash = '';
  window.history.replaceState(null, '', url.toString());
}

/** Should the app open straight into the online mode? */
export function shouldStartOnline(): boolean {
  if (typeof window === 'undefined') return false;
  if (readJoinCode() !== null) return true;
  return loadHostSession() !== null || loadGuestSession() !== null;
}

export function shareUrl(code: string): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  url.hash = `join=${code}`;
  url.search = '';
  return url.toString();
}
