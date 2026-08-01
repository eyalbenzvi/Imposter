/**
 * "Are these two Hebrew strings too close to sit in the same entry?"
 *
 * A hint only works if it makes the imposter guess. Anything that shares
 * visible material with the secret word stops being a guess and becomes a
 * read: "אוֹטוֹבּוּס" next to "תַּחֲנַת אוֹטוֹבּוּס" hands over the answer, and so
 * does "קַצֶּפֶת" next to "הַקְצָפָה" — one look at the letters is enough.
 *
 * Four ways two strings can be too close, in the order they are reported:
 *
 *   SAME     identical once the pointing is dropped
 *   TOKEN    they share a whole word — the "תחנת אוטובוס" case
 *   CONTAIN  one is spelled inside the other — כֶּלֶב inside כְּלַבְלַב, and
 *            word-by-word, so קָטָן inside קַטְנוֹעַ counts even with a second
 *            word attached
 *   ROOT     different words off one root — קַצֶּפֶת and הַקְצָפָה
 *
 * ROOT is a heuristic, not a morphological analysis: there is no root
 * dictionary here, so it peels off the prefixes and suffixes Hebrew actually
 * inflects with and compares what is left — branching on every peel rather than
 * committing to one, because the letters that inflect are also root letters.
 *
 * It errs toward flagging. A pair it catches by accident (כֶּבֶל / בֶּלֶם) is a
 * pair worth rewriting anyway; a pair it misses ships a giveaway.
 */

// Explicit extension: `scripts/validate-words.ts` imports this module through
// Node's type-stripping loader, which resolves specifiers exactly as written.
// Vite and tsc (`allowImportingTsExtensions`) both accept it too.
import { stripNiqqud } from './niqqud.ts';

/** Final forms, folded to their ordinary letter so ends of words compare. */
const FINALS: Record<string, string> = {
  'ך': 'כ',
  'ם': 'מ',
  'ן': 'נ',
  'ף': 'פ',
  'ץ': 'צ',
};

/**
 * Prefixes that attach in front of a whole word: the conjunction, the article,
 * and the one-letter prepositions, plus the participle מ־.
 */
const PREFIXES = ['ה', 'ו', 'ב', 'כ', 'ל', 'ש', 'מ'];

/** Inflection endings, longest first so "יות" wins over "ות" and "ת". */
const SUFFIXES = ['יות', 'ים', 'ות', 'ון', 'ית', 'יה', 'ה', 'ת', 'י'];

/** A root is three letters; nothing shorter is evidence of anything. */
const MIN_ROOT = 3;

/**
 * Pointing dropped, final forms folded, maqaf and quotes treated as a space.
 * Everything below compares these, never the pointed original.
 */
export function skeleton(value: string): string {
  // Maqaf becomes a break *before* the pointing is dropped, because it sits
  // inside the niqqud block: strip first and בֵּית־סֵפֶר glues into one token,
  // hiding the word it shares with בַּיִת.
  //
  // Geresh is the opposite case and must NOT break. In Hebrew it modifies the
  // letter it follows — ג', ז', צ' are single sounds — so splitting there would
  // leave a bare ג token that every other ג' word matches, and read גִּ'ינְס and
  // גִּ'ירָפָה as sharing a word.
  return stripNiqqud(value.replace(/[־]/g, ' '))
    .replace(/['"״׳]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c]!)
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(value: string): string[] {
  return skeleton(value).split(' ').filter(Boolean);
}

/**
 * Every three-letters-or-more form one token could reduce to.
 *
 * A single greedy strip is not enough, because the letters Hebrew inflects with
 * are also ordinary root letters: כְּתִיבָה and כּוֹתֵב are one root, but taking the
 * כ off the first (as a preposition) and leaving it on the second lands on two
 * different answers. So each optional step — one prefix, one suffix, the
 * mothers of reading — is *branched* rather than decided, and two tokens count
 * as related when any candidate is shared. Both readings of כְּתִיבָה are on the
 * table, and the one that matches כּוֹתֵב wins.
 *
 * Nothing that would leave fewer than three letters is ever produced, which is
 * what keeps short words (מַיִם, פֶּה, יָד) from dissolving into a match with
 * everything.
 */
export function stemCandidates(token: string): Set<string> {
  const fronts = [token];
  for (const prefix of PREFIXES) {
    if (token.startsWith(prefix) && token.length - prefix.length >= MIN_ROOT) {
      fronts.push(token.slice(prefix.length));
      break;
    }
  }

  const trimmed: string[] = [];
  for (const front of fronts) {
    trimmed.push(front);
    for (const suffix of SUFFIXES) {
      if (front.endsWith(suffix) && front.length - suffix.length >= MIN_ROOT) {
        trimmed.push(front.slice(0, -suffix.length));
        break;
      }
    }
  }

  const out = new Set<string>();
  for (const form of trimmed) {
    if (form.length >= MIN_ROOT) out.add(form);
    const bare = form.replace(/[וי]/g, '');
    if (bare.length >= MIN_ROOT && bare !== form) out.add(bare);
  }
  return out;
}

export type Overlap = 'SAME' | 'TOKEN' | 'CONTAIN' | 'ROOT';

/** How two strings overlap, or `null` when they are properly different. */
export function overlap(a: string, b: string): Overlap | null {
  const left = skeleton(a);
  const right = skeleton(b);
  if (left === '' || right === '') return null;
  if (left === right) return 'SAME';

  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.some((t) => rightTokens.includes(t))) return 'TOKEN';

  // Spelled inside the other, compared token against token so a two-word phrase
  // cannot hide it: קָטָן sits inside קַטְנוֹעַ whether or not either side has a
  // second word attached. Guarded at three letters, because two-letter words
  // turn up inside unrelated ones by chance (פֶּה in שָׂפָה, דֹּב in דְּבַשׁ).
  for (const a of leftTokens) {
    for (const b of rightTokens) {
      const [short, long] = a.length <= b.length ? [a, b] : [b, a];
      if (short.length >= MIN_ROOT && long.includes(short)) return 'CONTAIN';
    }
  }

  const leftStems = new Set<string>();
  for (const token of leftTokens) {
    for (const candidate of stemCandidates(token)) leftStems.add(candidate);
  }
  for (const token of rightTokens) {
    for (const candidate of stemCandidates(token)) {
      if (leftStems.has(candidate)) return 'ROOT';
    }
  }
  return null;
}

/** Why a pair was rejected, in Hebrew, for the validator's report. */
export const OVERLAP_REASON: Record<Overlap, string> = {
  SAME: 'אותה מילה',
  TOKEN: 'חולקים מילה שלמה',
  CONTAIN: 'אחת כתובה בתוך השנייה',
  ROOT: 'אותו שורש',
};
