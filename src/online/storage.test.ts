import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGuestSession,
  clearHostSession,
  loadGuestSession,
  loadHostSession,
  readJoinCode,
  saveGuestSession,
  saveHostSession,
  shouldStartOnline,
} from './storage';
import { loadGame, saveSnapshot } from '../ui/storage';
import { revealed, started } from './testUtils';

/** A localStorage good enough to exercise both modules against each other. */
function installStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  });
}

function installLocation(hash = ''): void {
  vi.stubGlobal('window', {
    location: { hash, href: `https://example.test/${hash}`, search: '' },
    history: { replaceState: () => {} },
  });
}

beforeEach(() => {
  installStorage();
  installLocation();
});

describe('the online session lives in its own slot', () => {
  /**
   * The failure this prevents: an online game written into the single-device
   * key restores on the next solo launch, walking whoever holds the phone
   * through every player's reveal card.
   */
  it('never writes into the single-device key', () => {
    const room = revealed(started(5));
    saveHostSession(room);
    expect(loadGame()).toBeNull();
    expect(localStorage.getItem('imposter/v1')).toBeNull();
  });

  it('is not disturbed by a single-device game in progress', () => {
    const solo = revealed(started(4)).state;
    saveSnapshot(solo);
    expect(loadHostSession()).toBeNull();

    const room = revealed(started(5));
    saveHostSession(room);
    // Both survive, side by side.
    expect(loadGame()).not.toBeNull();
    expect(loadHostSession()).not.toBeNull();
  });
});

describe('host session', () => {
  it('round-trips the state and, crucially, the seat order', () => {
    const room = revealed(started(6));
    saveHostSession(room);
    const saved = loadHostSession()!;
    expect(saved.code).toBe(room.code);
    expect(saved.epoch).toBe(room.epoch);
    expect(saved.seatOrder).toEqual(room.seatOrder);
    expect(saved.state).toEqual(room.state);
    expect(saved.locked).toBe(true);
  });

  it('forgets live connection ids, which mean nothing after a reload', () => {
    const room = revealed(started(4));
    saveHostSession(room);
    const saved = loadHostSession()!;
    expect(saved.seats[0]!.connId).toBe('host');
    for (const seat of saved.seats.slice(1)) expect(seat.connId).toBeNull();
  });

  it('drops a session older than the TTL', () => {
    saveHostSession(revealed(started(4)));
    const raw = JSON.parse(localStorage.getItem('imposter/online/v1')!);
    raw.host.at = Date.now() - 7 * 60 * 60 * 1000;
    localStorage.setItem('imposter/online/v1', JSON.stringify(raw));
    expect(loadHostSession()).toBeNull();
  });

  it('clears cleanly', () => {
    saveHostSession(revealed(started(4)));
    clearHostSession();
    expect(loadHostSession()).toBeNull();
  });
});

describe('guest session', () => {
  it('round-trips', () => {
    saveGuestSession({ code: '4271', seatId: 's2', name: 'דנה' });
    expect(loadGuestSession()).toMatchObject({ code: '4271', seatId: 's2', name: 'דנה' });
  });

  it('only answers for the room it was issued in', () => {
    saveGuestSession({ code: '4271', seatId: 's2', name: 'דנה' });
    expect(loadGuestSession('4271')).not.toBeNull();
    expect(loadGuestSession('8830')).toBeNull();
  });

  it('does not clobber the host session, or the other way round', () => {
    saveHostSession(revealed(started(4)));
    saveGuestSession({ code: '4271', seatId: 's2', name: 'דנה' });
    expect(loadHostSession()).not.toBeNull();
    expect(loadGuestSession()).not.toBeNull();
    clearGuestSession();
    expect(loadHostSession()).not.toBeNull();
    expect(loadGuestSession()).toBeNull();
  });
});

describe('opening straight into the online mode', () => {
  it('does so for a shared join link', () => {
    installLocation('#join=4271');
    expect(readJoinCode()).toBe('4271');
    expect(shouldStartOnline()).toBe(true);
  });

  it('ignores a malformed hash', () => {
    installLocation('#join=abc');
    expect(readJoinCode()).toBeNull();
    expect(shouldStartOnline()).toBe(false);
  });

  it('does so for a host or guest session that is still warm', () => {
    expect(shouldStartOnline()).toBe(false);
    saveGuestSession({ code: '4271', seatId: 's1', name: 'דנה' });
    expect(shouldStartOnline()).toBe(true);
  });

  /** A solo game in progress must keep opening the solo app, as it always has. */
  it('does not for a single-device game in progress', () => {
    saveSnapshot(revealed(started(4)).state);
    expect(shouldStartOnline()).toBe(false);
  });
});
