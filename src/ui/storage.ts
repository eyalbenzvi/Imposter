/**
 * localStorage persistence. Player names, the game mode and every other
 * setting survive between sessions, and so does a game in progress — a stray
 * refresh in the middle of a round shouldn't cost the group its game.
 */

import { DEFAULT_SETTINGS } from '../game/reducer';
import type { GameState, Settings } from '../game/types';

const KEY = 'imposter/v1';

type Saved = {
  names: string[];
  settings: Settings;
  /** The live game, so a refresh lands back where the group was. */
  game: GameState | null;
};

function read(): Partial<Saved> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Saved>) : {};
  } catch {
    return {};
  }
}

function write(value: Partial<Saved>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...value }));
  } catch {
    // A private-mode browser with no storage quota is not a reason to break.
  }
}

export function loadNames(): string[] {
  const names = read().names;
  return Array.isArray(names) ? names.filter((n) => typeof n === 'string') : [];
}

export function loadSettings(): Settings {
  const saved = read().settings;
  return saved && typeof saved === 'object'
    ? { ...DEFAULT_SETTINGS, ...saved }
    : { ...DEFAULT_SETTINGS };
}

export function loadGame(): GameState | null {
  const game = read().game;
  if (!game || typeof game !== 'object' || !('phase' in game)) return null;
  // A finished or unstarted game isn't worth restoring into.
  return game.phase === 'SETUP' ? null : game;
}

export function saveSnapshot(state: GameState): void {
  write({
    names: state.players.map((p) => p.name),
    settings: state.settings,
    game: state.phase === 'SETUP' ? null : state,
  });
}

export function clearGame(): void {
  write({ game: null });
}
