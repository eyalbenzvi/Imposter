/**
 * Who gets a say, and how many of them it takes.
 *
 * Split out from the driver so the view can render exactly the counter the
 * driver will act on — a "3 / 5 ready" that disagrees with the rule that fires
 * is worse than no counter at all.
 *
 * The governing rule:
 *
 *   A MAJORITY decides transitions. Input the ENGINE demands from every player
 *   is required from every player.
 *
 * So reveal and voting wait for everyone (the reducer cannot proceed without
 * each one), while "on to the vote" and "another round" go on a majority.
 */

import { aliveIds } from '../game/rules';
import type { GameState, PlayerId } from '../game/types';
import type { ChoiceOption } from './protocol';
import type { Room } from './room';
import type { WaitingKind } from './view';

export function majority(n: number): number {
  return Math.floor(n / 2) + 1;
}

/**
 * What the room is currently waiting for, or null when the phase needs no
 * collective input (a single player's turn to type or guess is tracked
 * separately, through `isYourTurn`).
 */
export function waitingKind(state: GameState): WaitingKind | null {
  switch (state.phase) {
    case 'REVEAL':
      return 'REVEAL';
    case 'CLUES':
      return 'CLUE';
    case 'DISCUSSION':
      return 'CHOOSE';
    case 'VOTING':
      return 'VOTE';
    case 'VOTE_RESULT':
    case 'GAME_OVER':
      return 'READY';
    default:
      return null;
  }
}

/**
 * Who is entitled to be counted.
 *
 * The two that are easy to get wrong, and both were:
 *
 *  • VOTE_RESULT and GAME_OVER count EVERYONE, not just the living. The round
 *    is over; the players who were voted out are still in the room holding
 *    phones, and "shall we play again" is not a decision the survivors get to
 *    make alone. With four ejections in a twelve-player game, an alive-only
 *    electorate silences a third of the room.
 *  • REVEAL counts everyone too, though at that point everyone is alive
 *    anyway — `dealRoles` resets `alive` for the whole roster.
 */
export function electorate(state: GameState, kind: WaitingKind): PlayerId[] {
  switch (kind) {
    case 'REVEAL':
      return state.players.map((p) => p.id);
    case 'READY':
      return state.players.map((p) => p.id);
    case 'CLUE':
    case 'CHOOSE':
    case 'VOTE':
      return aliveIds(state);
  }
}

/** How many of the electorate it takes to move. */
export function neededFor(state: GameState, kind: WaitingKind): number {
  const voters = electorate(state, kind);
  switch (kind) {
    // The engine needs input from each of these, so a majority is not enough.
    case 'REVEAL':
    case 'VOTE':
      return voters.length;
    // A clue round advances one player at a time; the "skip to discussion"
    // shortcut is the only collective call, and it goes on a majority.
    case 'CLUE':
    case 'CHOOSE':
    case 'READY':
      return majority(voters.length);
  }
}

/** Which players have already supplied what this phase is waiting for. */
export function pendingSetFor(room: Room, kind: WaitingKind): PlayerId[] {
  switch (kind) {
    case 'REVEAL':
      return room.pending.reveal;
    case 'READY':
      return room.pending.ready;
    case 'CHOOSE':
      return Object.keys(room.pending.choice);
    case 'VOTE':
      return Object.keys(room.pending.votes);
    case 'CLUE':
      // A clue round is per-turn, so "who has skipped" is the collective count.
      return room.pending.ready;
  }
}

export function choiceTally(room: Room): { VOTE: number; ANOTHER_ROUND: number } {
  const tally = { VOTE: 0, ANOTHER_ROUND: 0 };
  for (const option of Object.values(room.pending.choice)) {
    tally[option as ChoiceOption] += 1;
  }
  return tally;
}

/**
 * How the discussion resolves.
 *
 * A majority for either option wins outright. An even split cannot be left to
 * hang — with four alive, 2–2 reaches a majority for neither and the room just
 * stops — so once everybody alive has chosen, the game-advancing option wins.
 */
export function resolveChoice(
  state: GameState,
  choice: Record<PlayerId, ChoiceOption>,
): ChoiceOption | null {
  const voters = electorate(state, 'CHOOSE');
  const need = majority(voters.length);
  let toVote = 0;
  let another = 0;
  for (const id of voters) {
    if (choice[id] === 'VOTE') toVote++;
    else if (choice[id] === 'ANOTHER_ROUND') another++;
  }
  if (toVote >= need) return 'VOTE';
  if (another >= need) return 'ANOTHER_ROUND';
  if (toVote + another >= voters.length) return 'VOTE';
  return null;
}
