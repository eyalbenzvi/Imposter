/**
 * Every type in this file must be JSON-serializable: no Date, Map, Set or
 * class instances. The whole game lives in one `GameState` object so a future
 * online mode can ship it over the wire untouched.
 */

export type PlayerId = string;

export type Phase =
  | 'SETUP'
  | 'REVEAL'
  | 'CLUES'
  | 'DISCUSSION'
  | 'VOTING'
  | 'VOTE_RESULT'
  | 'IMPOSTER_GUESS'
  | 'GAME_OVER';

/** HIDDEN = the imposter does not know they are the imposter (default). */
export type GameMode = 'HIDDEN' | 'KNOWN';

/** SPEAK = clues said out loud, app only tracks turn order (default). */
export type ClueMode = 'SPEAK' | 'TYPE';

export type Winner = 'CITIZENS' | 'IMPOSTERS';

export type DiscussionSeconds = 0 | 60 | 90 | 120;

export type Settings = {
  mode: GameMode;
  clueMode: ClueMode;
  imposterCount: number;
  /** 0 = no timer. */
  discussionSeconds: DiscussionSeconds;
  /** 0 = no per-turn timer. */
  clueTimerSeconds: number;
  imposterGuessEnabled: boolean;
};

export type Player = {
  id: PlayerId;
  name: string;
  /** Ground truth. Never handed to the UI directly — see `getRevealView`. */
  isImposter: boolean;
  alive: boolean;
};

export type Vote = { voter: PlayerId; target: PlayerId };

export type TallyRow = { playerId: PlayerId; count: number };

export type VoteOutcome = 'EJECTED' | 'TIE_RUNOFF' | 'TIE_NO_EJECTION';

export type VoteResult = {
  /** Descending by count, then by player order — stable for rendering. */
  tally: TallyRow[];
  /** Full breakdown of who voted for whom, revealed only after everyone voted. */
  votes: Vote[];
  ejectedId: PlayerId | null;
  ejectedWasImposter: boolean | null;
  outcome: VoteOutcome;
  /** Leaders of a tied vote — the runoff candidates. */
  tiedIds: PlayerId[];
};

export type GameState = {
  phase: Phase;
  settings: Settings;
  players: Player[];
  imposterIds: PlayerId[];

  /** Clue round counter within the current game, 1-based. */
  roundNumber: number;
  secretWordId: string | null;
  /** Which of the entry's 5 hints was drawn. */
  hintIndex: number | null;
  /** The drawn hint, pointed. Both imposters get this same word. */
  hintWord: string | null;

  // REVEAL
  revealIndex: number;
  /** false = "pass the device to X" screen, true = word is on screen. */
  revealShown: boolean;

  // CLUES
  turnOrder: PlayerId[];
  clueTurnIndex: number;
  /** Only used in TYPE mode; cleared at the start of every clue round. */
  clues: Record<PlayerId, string>;

  // VOTING
  voteStage: 'FIRST' | 'RUNOFF';
  /** Who may be voted for. Narrowed to the leaders during a runoff. */
  eligibleTargets: PlayerId[];
  voterOrder: PlayerId[];
  voterIndex: number;
  votes: Vote[];

  // VOTE_RESULT
  lastVote: VoteResult | null;

  // IMPOSTER_GUESS
  guessingImposterId: PlayerId | null;
  /** 4 word ids from the secret word's category, shuffled. */
  guessOptions: string[] | null;
  guessResult: 'CORRECT' | 'WRONG' | null;

  winner: Winner | null;
};

export type Action =
  // SETUP
  | { type: 'SET_PLAYERS'; names: string[] }
  | { type: 'UPDATE_SETTINGS'; patch: Partial<Settings> }
  | { type: 'START_GAME'; seed: string }
  // REVEAL
  | { type: 'SHOW_ROLE' }
  | { type: 'HIDE_ROLE' }
  // CLUES
  | { type: 'SUBMIT_CLUE'; playerId: PlayerId; text: string }
  | { type: 'NEXT_CLUE_TURN' }
  | { type: 'FINISH_CLUES' }
  // DISCUSSION / VOTING
  | { type: 'START_VOTING' }
  | { type: 'CAST_VOTE'; voter: PlayerId; target: PlayerId }
  // VOTE_RESULT
  | { type: 'CONTINUE'; seed: string }
  // IMPOSTER_GUESS
  | { type: 'SUBMIT_GUESS'; wordId: string }
  // GAME_OVER
  | { type: 'NEW_ROUND'; seed: string }
  | { type: 'BACK_TO_SETUP' };

export type ActionType = Action['type'];

/** A pointed word plus the five sibling words that can stand in for it. */
export type WordEntry = {
  /** Unique latin slug, e.g. "pizza". */
  id: string;
  /** Fully pointed Hebrew. */
  word: string;
  /** Exactly 5 fully pointed sibling words. */
  hints: string[];
  category: string;
};

/**
 * What a single player is allowed to see on their reveal screen.
 *
 * In HIDDEN mode every player gets `kind: 'PLAIN'` — structurally identical
 * objects, with nothing anywhere in the payload that marks the imposter.
 * In KNOWN mode the imposter is told, but never learns who the other
 * imposter is: there is no field that could carry that.
 */
export type RevealView =
  | { kind: 'PLAIN'; playerName: string; word: string }
  | { kind: 'CITIZEN'; playerName: string; word: string }
  | { kind: 'IMPOSTER'; playerName: string; word: string };

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;
export const GUESS_OPTION_COUNT = 4;
export const HINTS_PER_WORD = 5;
