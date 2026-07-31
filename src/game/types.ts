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

/**
 * What the imposter is handed instead of the secret word.
 *
 * SIBLING — a similar word from the same category. This is what HIDDEN mode
 * must use: the imposter does not know they are the imposter, so anything that
 * doesn't read like an ordinary word from the pool would give it away.
 * CLUE — a hint about the real word. Only KNOWN mode, where the imposter has
 * already been told, so there is nothing left to disguise and a clue is what
 * lets them bluff on purpose.
 */
export type ImposterHintKind = 'SIBLING' | 'CLUE';

/** The three kinds of clue an entry carries, in a fixed order. */
export const CLUE_KINDS = ['pair', 'related', 'trait'] as const;
export type ClueKind = (typeof CLUE_KINDS)[number];

/**
 * Clues about a word, for KNOWN mode. Taking סוּס as the example:
 *   pair    — a word that goes with it: עֲבוֹדָה, כֹּחַ
 *   related — a thing that belongs with it: אֻכָּף, פַּרְסָה
 *   trait   — what it is like: מָהִיר
 */
export type WordClues = Record<ClueKind, string>;

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
  /**
   * Which categories the secret word may come from. Empty means all of them,
   * which is also what a selection naming only unknown categories falls back
   * to — a setting saved by an older build must never leave a group with no
   * words to play.
   */
  categories: string[];
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
  /** Which of the entry's 5 hints was drawn. Only meaningful for SIBLING. */
  hintIndex: number | null;
  /** Whether `hintWord` is a sibling word or a clue — decided by game mode. */
  hintKind: ImposterHintKind | null;
  /** Which kind of clue was drawn. Only meaningful for CLUE. */
  clueKind: ClueKind | null;
  /** What the imposter is shown, pointed. Both imposters get this same text. */
  hintWord: string | null;

  // REVEAL
  /**
   * The order roles are handed out in — shuffled, so the sequence carries no
   * information about who was entered first and can't be predicted.
   */
  revealOrder: PlayerId[];
  revealIndex: number;
  /** false = "pass the device to X" screen, true = word is on screen. */
  revealShown: boolean;
  /**
   * How many times each player's word has been uncovered this game. The reveal
   * flow only ever moves forward, so every count lands on exactly 1 — which is
   * what lets the app show the group proof that nobody got a second look.
   */
  revealViews: Record<PlayerId, number>;

  // CLUES
  turnOrder: PlayerId[];
  /**
   * Speaking order for the discussion, drawn independently of `turnOrder` and
   * of `revealOrder` — three separate shuffles, so knowing one tells you
   * nothing about the others.
   */
  discussionOrder: PlayerId[];
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
  /** Run one more clue round instead of voting. Keeps the same secret word. */
  | { type: 'ANOTHER_CLUE_ROUND'; seed: string }
  | { type: 'START_VOTING'; seed: string }
  | { type: 'CAST_VOTE'; voter: PlayerId; target: PlayerId }
  // VOTE_RESULT
  | { type: 'CONTINUE'; seed: string }
  // IMPOSTER_GUESS
  | { type: 'SUBMIT_GUESS'; wordId: string }
  // GAME_OVER
  | { type: 'NEW_ROUND'; seed: string }
  | { type: 'BACK_TO_SETUP' };

export type ActionType = Action['type'];

/**
 * A pointed word, the five sibling words that can stand in for it in HIDDEN
 * mode, and the three clues KNOWN mode draws from.
 */
export type WordEntry = {
  /** Unique latin slug, e.g. "pizza". */
  id: string;
  /** Fully pointed Hebrew. */
  word: string;
  /** Exactly 5 fully pointed sibling words from the same category. */
  hints: string[];
  /**
   * Optional in the type so the app still runs against a store whose clues
   * aren't written yet — KNOWN mode falls back to a sibling word. The validator
   * requires them, so this is a safety net, not a licence to skip them.
   */
  clues?: WordClues;
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
  | {
      kind: 'IMPOSTER';
      playerName: string;
      word: string;
      /** Lets the card say "your substitute word" or "a clue", correctly. */
      hintKind: ImposterHintKind;
    };

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;
export const GUESS_OPTION_COUNT = 4;
export const HINTS_PER_WORD = 5;
