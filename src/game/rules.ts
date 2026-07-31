/**
 * Pure rule helpers and read-only projections over `GameState`.
 * No React, no randomness that isn't seeded, no mutation.
 */

import {
  GUESS_OPTION_COUNT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type GameState,
  type Player,
  type PlayerId,
  type RevealView,
  type TallyRow,
  type Vote,
  type VoteResult,
  type WordEntry,
  type Winner,
} from './types';
import { stripNiqqud } from './niqqud';
import { makeRng, type Rng } from './prng';
import { WORDS, getWordEntry, wordsInCategory } from './words';

// ── players ──────────────────────────────────────────────────────────────────

export function alivePlayers(state: GameState): Player[] {
  return state.players.filter((p) => p.alive);
}

export function aliveIds(state: GameState): PlayerId[] {
  return alivePlayers(state).map((p) => p.id);
}

export function playerById(state: GameState, id: PlayerId): Player {
  const found = state.players.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown player: ${id}`);
  return found;
}

/** The player whose turn it is to be handed the device, by shuffled order. */
export function playerAtReveal(state: GameState, index: number): Player {
  const id = state.revealOrder[index];
  if (!id) throw new Error(`No player at reveal position ${index}`);
  return playerById(state, id);
}

export function aliveImposterCount(state: GameState): number {
  return state.players.filter((p) => p.alive && p.isImposter).length;
}

export function aliveCitizenCount(state: GameState): number {
  return state.players.filter((p) => p.alive && !p.isImposter).length;
}

/** 2 imposters become the suggested default from 7 players up. */
export function suggestImposterCount(playerCount: number): number {
  return playerCount >= 7 ? 2 : 1;
}

/**
 * Imposters must start strictly outnumbered, otherwise the game would already
 * be over on turn one.
 */
export function maxImposterCount(playerCount: number): number {
  return Math.max(1, Math.floor((playerCount - 1) / 2));
}

export function playerCountIsValid(count: number): boolean {
  return count >= MIN_PLAYERS && count <= MAX_PLAYERS;
}

// ── win conditions ───────────────────────────────────────────────────────────

/**
 * A single rule covers both imposter counts: with one imposter,
 * "imposters >= citizens" is exactly "two players left and one is the
 * imposter".
 */
export function checkWinner(state: GameState): Winner | null {
  const imposters = aliveImposterCount(state);
  if (imposters === 0) return 'CITIZENS';
  if (imposters >= aliveCitizenCount(state)) return 'IMPOSTERS';
  return null;
}

// ── words ────────────────────────────────────────────────────────────────────

export function getSecretEntry(state: GameState): WordEntry | null {
  return state.secretWordId ? getWordEntry(state.secretWordId) : null;
}

export function getSecretWord(state: GameState): string | null {
  return getSecretEntry(state)?.word ?? null;
}

/**
 * The 4 options shown to a caught imposter: the real word plus 3 siblings from
 * the same category, deduped without niqqud and shuffled.
 *
 * Falls back to the rest of the store if a category is too small, so the app
 * still works against a partially filled word store.
 */
export function buildGuessOptions(secretWordId: string, rng: Rng): string[] {
  const secret = getWordEntry(secretWordId);
  const seen = new Set([stripNiqqud(secret.word)]);

  const isFresh = (entry: WordEntry): boolean => {
    const key = stripNiqqud(entry.word);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  const sameCategory = wordsInCategory(secret.category).filter(
    (entry) => entry.id !== secret.id,
  );
  const distractors = rng.shuffle(sameCategory).filter(isFresh);

  if (distractors.length < GUESS_OPTION_COUNT - 1) {
    const elsewhere = rng
      .shuffle(WORDS.filter((entry) => entry.category !== secret.category))
      .filter(isFresh);
    distractors.push(...elsewhere);
  }

  const options = [
    secret.id,
    ...distractors.slice(0, GUESS_OPTION_COUNT - 1).map((entry) => entry.id),
  ];
  return rng.shuffle(options);
}

// ── reveal projection ────────────────────────────────────────────────────────

/**
 * The ONLY channel through which the UI learns what to put on a reveal screen.
 *
 * HIDDEN mode returns `kind: 'PLAIN'` for everyone, so the object an imposter
 * receives is structurally indistinguishable from a citizen's. Neither mode
 * ever exposes the identity of a fellow imposter — no field can carry it.
 */
export function getRevealView(state: GameState, playerId: PlayerId): RevealView {
  const player = playerById(state, playerId);
  const secret = getSecretWord(state);
  if (secret === null || state.hintWord === null) {
    throw new Error('getRevealView: no word has been drawn yet');
  }

  const word = player.isImposter ? state.hintWord : secret;

  if (state.settings.mode === 'HIDDEN') {
    return { kind: 'PLAIN', playerName: player.name, word };
  }
  return {
    kind: player.isImposter ? 'IMPOSTER' : 'CITIZEN',
    playerName: player.name,
    word,
  };
}

// ── reveal audit ─────────────────────────────────────────────────────────────

/** How many times this player's word was uncovered. Always 0 or 1. */
export function revealViewsFor(state: GameState, playerId: PlayerId): number {
  return state.revealViews[playerId] ?? 0;
}

/**
 * Proof for the group that the handout was clean: every player uncovered their
 * word exactly once, so nobody got a second look at anyone's screen.
 */
export function revealAudit(state: GameState): {
  rows: { playerId: PlayerId; name: string; views: number }[];
  everyoneSawOnce: boolean;
  extraViews: number;
} {
  const rows = state.players.map((p) => ({
    playerId: p.id,
    name: p.name,
    views: revealViewsFor(state, p.id),
  }));
  return {
    rows,
    everyoneSawOnce: rows.every((r) => r.views === 1),
    extraViews: rows.reduce((sum, r) => sum + Math.max(0, r.views - 1), 0),
  };
}

// ── voting ───────────────────────────────────────────────────────────────────

/** Who this voter may pick: eligible targets minus themselves. */
export function voteTargetsFor(state: GameState, voter: PlayerId): PlayerId[] {
  return state.eligibleTargets.filter((id) => id !== voter);
}

export function currentVoter(state: GameState): PlayerId | null {
  return state.voterOrder[state.voterIndex] ?? null;
}

export function hasVoted(state: GameState, voter: PlayerId): boolean {
  return state.votes.some((v) => v.voter === voter);
}

/**
 * Count the votes. Every eligible target gets a row (including zero) so the UI
 * can render a complete board; ties are broken for display only, by the
 * players' original order.
 */
export function tallyVotes(
  state: GameState,
  votes: Vote[],
): { tally: TallyRow[]; leaders: PlayerId[] } {
  const order = state.players.map((p) => p.id);
  const counts: Record<PlayerId, number> = {};
  for (const id of state.eligibleTargets) counts[id] = 0;
  for (const vote of votes) {
    counts[vote.target] = (counts[vote.target] ?? 0) + 1;
  }

  const tally: TallyRow[] = Object.keys(counts)
    .map((playerId) => ({ playerId, count: counts[playerId]! }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        order.indexOf(a.playerId) - order.indexOf(b.playerId),
    );

  const top = tally[0]?.count ?? 0;
  const leaders = tally.filter((row) => row.count === top).map((r) => r.playerId);
  return { tally, leaders };
}

/**
 * Resolve a completed vote. A first-round tie sends the leaders to a runoff;
 * a second tie means nobody is ejected this round.
 */
export function resolveVote(state: GameState, votes: Vote[]): VoteResult {
  const { tally, leaders } = tallyVotes(state, votes);

  if (leaders.length === 1) {
    const ejectedId = leaders[0]!;
    return {
      tally,
      votes,
      ejectedId,
      ejectedWasImposter: playerById(state, ejectedId).isImposter,
      outcome: 'EJECTED',
      tiedIds: [],
    };
  }

  return {
    tally,
    votes,
    ejectedId: null,
    ejectedWasImposter: null,
    outcome: state.voteStage === 'FIRST' ? 'TIE_RUNOFF' : 'TIE_NO_EJECTION',
    tiedIds: leaders,
  };
}

// ── misc ─────────────────────────────────────────────────────────────────────

/** Turn order for a clue round, reshuffled every round so the opener changes. */
export function drawTurnOrder(ids: readonly PlayerId[], seed: string): PlayerId[] {
  return makeRng(seed).shuffle(ids);
}

export function clueRoundIsComplete(state: GameState): boolean {
  return state.clueTurnIndex >= state.turnOrder.length;
}

export function currentCluePlayer(state: GameState): PlayerId | null {
  return state.turnOrder[state.clueTurnIndex] ?? null;
}
