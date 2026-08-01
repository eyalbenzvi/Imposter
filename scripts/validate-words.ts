/**
 * Word-store validator. Run with `npm run validate:words`.
 *
 * Reads the JSON files straight off disk (rather than importing the store) so
 * that raw-file problems — bad JSON, non-NFC strings — are caught too.
 *
 * Exits non-zero with a readable report on:
 *   1. an entry that does not match the schema, or does not have exactly 5 hints
 *   2. a duplicate id, or the same word in two categories (compared WITHOUT niqqud)
 *   3. a word or hint with no niqqud at all
 *   4. a hint equal to its own word, or two identical hints in one entry
 *   5. a category with fewer than 100 entries (each one must be playable alone)
 *   6. a missing or bad KNOWN-mode clue: not three of them, unpointed, repeated,
 *      containing the word itself, equal to one of the hints, or equal to another
 *      entry in the same category (that would make it a sibling, not a clue)
 *   7. anything longer than two words — a word, a hint or a clue. A clue that
 *      needs a sentence is describing the word rather than pointing at it, which
 *      is how "מדביקים אותו וכשמורידים זה כואב" gave away פְּלַסְטֶר.
 *   8. any two pieces of one entry that are too close to each other: the word,
 *      its five hints and its three clues all reach the same player, so a pair
 *      sharing a whole word (אוֹטוֹבּוּס / תַּחֲנַת אוֹטוֹבּוּס), spelled inside one
 *      another (כֶּלֶב / כְּלַבְלַב) or built on one root (קַצֶּפֶת / הַקְצָפָה) makes
 *      the round readable instead of guessable. See `src/game/overlap.ts`.
 *
 * Plus two consistency checks that keep the pointing honest:
 *   9. a hint that also exists as an entry must be spelled and pointed identically
 *  10. every string must already be NFC-normalized
 */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { hasNiqqud, normalize, stripNiqqud } from '../src/game/niqqud.ts';
import { OVERLAP_REASON, overlap } from '../src/game/overlap.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORDS_DIR = join(HERE, '..', 'src', 'game', 'words');
const HINTS_REQUIRED = 5;
// Product rule, not a technical floor: every category a group can pick must be
// deep enough to play from on its own. (The guess screen needs only 4 options.)
const MIN_ENTRIES_PER_CATEGORY = 100;

type RawEntry = {
  id?: unknown;
  word?: unknown;
  hints?: unknown;
  category?: unknown;
};

const CLUE_KINDS = ['pair', 'related', 'trait'] as const;
const MAX_WORDS = 2;

/** Word count ignoring niqqud, so maqaf-free two-word phrases count as two. */
function wordCount(value: string): number {
  return stripNiqqud(value).trim().split(/\s+/).filter(Boolean).length;
}

const errors: string[] = [];
const notes: string[] = [];

function fail(file: string, where: string, message: string): void {
  errors.push(`  ✗ ${file} → ${where}: ${message}`);
}

const files = readdirSync(WORDS_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error('No word files found in src/game/words');
  process.exit(1);
}

/** id → file, for duplicate detection across files. */
const idOwner = new Map<string, string>();
/** stripped word → "file:id", for cross-category duplicate detection. */
const plainOwner = new Map<string, string>();
/** stripped word → pointed word, to enforce one pointing per word. */
const pointedByPlain = new Map<string, string>();
const categoryCounts = new Map<string, number>();
const allHints: { file: string; id: string; hint: string }[] = [];
const clueUses: { file: string; id: string; category: string; value: string }[] = [];
/** stripped word → its category, for the "clue is a sibling entry" check. */
const categoryOfPlain = new Map<string, string>();

let totalEntries = 0;
const emptyFiles: string[] = [];

for (const file of files) {
  const label = basename(file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(WORDS_DIR, file), 'utf8'));
  } catch (err) {
    fail(label, 'file', `is not valid JSON — ${(err as Error).message}`);
    continue;
  }

  if (!Array.isArray(parsed)) {
    fail(label, 'file', 'must contain a JSON array of entries');
    continue;
  }

  if (parsed.length === 0) {
    // A not-yet-written category. The app works with a partial store, so this
    // is reported but not an error.
    emptyFiles.push(label);
    continue;
  }

  parsed.forEach((raw: RawEntry, index) => {
    const where = typeof raw?.id === 'string' ? `"${raw.id}"` : `entry #${index + 1}`;

    // ── 1. schema ───────────────────────────────────────────────────────────
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      fail(label, where, 'must be an object');
      return;
    }
    if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(raw.id)) {
      fail(label, where, 'id must be a lowercase latin slug');
      return;
    }
    if (typeof raw.word !== 'string' || raw.word.trim() === '') {
      fail(label, where, 'word must be a non-empty string');
      return;
    }
    if (typeof raw.category !== 'string' || raw.category.trim() === '') {
      fail(label, where, 'category must be a non-empty string');
      return;
    }
    if (!Array.isArray(raw.hints) || raw.hints.length !== HINTS_REQUIRED) {
      fail(
        label,
        where,
        `must have exactly ${HINTS_REQUIRED} hints, found ${
          Array.isArray(raw.hints) ? raw.hints.length : typeof raw.hints
        }`,
      );
      return;
    }
    if (raw.hints.some((h) => typeof h !== 'string' || h.trim() === '')) {
      fail(label, where, 'every hint must be a non-empty string');
      return;
    }

    const entry = {
      id: raw.id,
      word: raw.word,
      hints: raw.hints as string[],
      category: raw.category,
    };
    totalEntries++;
    categoryCounts.set(entry.category, (categoryCounts.get(entry.category) ?? 0) + 1);

    // ── 7. NFC ──────────────────────────────────────────────────────────────
    for (const [name, value] of [
      ['word', entry.word] as const,
      ...entry.hints.map((h, i) => [`hint #${i + 1}`, h] as const),
    ]) {
      if (normalize(value) !== value) {
        fail(label, where, `${name} "${value}" is not NFC-normalized`);
      }
    }

    // ── 2. duplicate ids / words ────────────────────────────────────────────
    const owner = idOwner.get(entry.id);
    if (owner) {
      fail(label, where, `duplicate id — already defined in ${owner}`);
    } else {
      idOwner.set(entry.id, label);
    }

    const plain = stripNiqqud(entry.word);
    const plainHome = plainOwner.get(plain);
    if (plainHome) {
      fail(
        label,
        where,
        `duplicate word "${plain}" (ignoring niqqud) — already defined as ${plainHome}`,
      );
    } else {
      plainOwner.set(plain, `${label}:${entry.id}`);
      pointedByPlain.set(plain, entry.word);
      categoryOfPlain.set(plain, entry.category);
    }

    // ── 7. length ───────────────────────────────────────────────────────────
    if (wordCount(entry.word) > MAX_WORDS) {
      fail(label, where, `word "${entry.word}" is more than ${MAX_WORDS} words`);
    }
    entry.hints.forEach((hint, i) => {
      if (wordCount(hint) > MAX_WORDS) {
        fail(label, where, `hint #${i + 1} "${hint}" is more than ${MAX_WORDS} words`);
      }
    });

    // ── 3. niqqud present ───────────────────────────────────────────────────
    if (!hasNiqqud(entry.word)) {
      fail(label, where, `word "${entry.word}" has no niqqud`);
    }
    entry.hints.forEach((hint, i) => {
      if (!hasNiqqud(hint)) {
        fail(label, where, `hint #${i + 1} "${hint}" has no niqqud`);
      }
      allHints.push({ file: label, id: entry.id, hint });
    });

    // ── 6. clues ────────────────────────────────────────────────────────
    const rawClues = (raw as { clues?: unknown }).clues;
    if (rawClues === undefined) {
      fail(label, where, 'has no KNOWN-mode clues');
    } else if (typeof rawClues !== 'object' || rawClues === null) {
      fail(label, where, 'clues must be an object');
    } else {
      const clues = rawClues as Record<string, unknown>;
      const seenClues = new Map<string, string>();
      const hintPlains = new Set(entry.hints.map((h) => stripNiqqud(h).trim()));
      for (const kind of CLUE_KINDS) {
        const value = clues[kind];
        if (typeof value !== 'string' || value.trim() === '') {
          fail(label, where, `clue "${kind}" must be a non-empty string`);
          continue;
        }
        if (normalize(value) !== value) {
          fail(label, where, `clue "${kind}" is not NFC-normalized`);
        }
        if (!hasNiqqud(value)) {
          fail(label, where, `clue "${kind}" "${value}" has no niqqud`);
        }
        if (wordCount(value) > MAX_WORDS) {
          fail(
            label,
            where,
            `clue "${kind}" "${value}" is more than ${MAX_WORDS} words — that is a description, not a clue`,
          );
        }
        const cluePlain = stripNiqqud(value).trim();
        // A clue that spells the word out is not a clue.
        if (cluePlain.split(/\s+/).includes(plain)) {
          fail(label, where, `clue "${kind}" "${value}" contains the word itself`);
        }
        if (hintPlains.has(cluePlain)) {
          fail(label, where, `clue "${kind}" "${value}" repeats one of the hints`);
        }
        const firstKind = seenClues.get(cluePlain);
        if (firstKind) {
          fail(label, where, `clue "${kind}" repeats clue "${firstKind}"`);
        } else {
          seenClues.set(cluePlain, kind);
        }
        clueUses.push({ file: label, id: entry.id, category: entry.category, value });
      }
      for (const key of Object.keys(clues)) {
        if (!(CLUE_KINDS as readonly string[]).includes(key)) {
          fail(label, where, `unknown clue kind "${key}"`);
        }
      }
    }

    // ── 4. hint uniqueness ──────────────────────────────────────────────────
    const seenHints = new Map<string, number>();
    entry.hints.forEach((hint, i) => {
      const key = stripNiqqud(hint).trim();
      if (key === plain) {
        fail(label, where, `hint #${i + 1} "${hint}" is the word itself`);
      }
      const first = seenHints.get(key);
      if (first !== undefined) {
        fail(
          label,
          where,
          `hint #${i + 1} "${hint}" repeats hint #${first + 1} (ignoring niqqud)`,
        );
      } else {
        seenHints.set(key, i);
      }
    });

    // ── 8. nothing in an entry may echo anything else in it ─────────────────
    // The word, its five hints and its three clues all land in front of the
    // same player. Any two of them that share a whole word, spell one another
    // out or come off one root make the round readable instead of guessable.
    const pieces: [string, string][] = [
      ['the word', entry.word],
      ...entry.hints.map((h, i) => [`hint #${i + 1}`, h] as [string, string]),
      ...(rawClues !== null && typeof rawClues === 'object'
        ? CLUE_KINDS.filter(
            (k) => typeof (rawClues as Record<string, unknown>)[k] === 'string',
          ).map(
            (k) =>
              [`clue "${k}"`, (rawClues as Record<string, string>)[k]!] as [
                string,
                string,
              ],
          )
        : []),
    ];
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const [nameA, valueA] = pieces[i]!;
        const [nameB, valueB] = pieces[j]!;
        const kind = overlap(valueA, valueB);
        // SAME is already reported, with a better message, by the checks above.
        if (kind !== null && kind !== 'SAME') {
          fail(
            label,
            where,
            `${nameA} "${valueA}" and ${nameB} "${valueB}" — ${OVERLAP_REASON[kind]} (${kind})`,
          );
        }
      }
    }
  });
}

// ── 6b. a clue must not be a word from its own category ──────────────────────
// Those are what `hints` are for. A clue that happens to be a sibling would turn
// KNOWN mode back into HIDDEN mode without anybody noticing.
for (const use of clueUses) {
  const home = categoryOfPlain.get(stripNiqqud(use.value).trim());
  if (home !== undefined && home === use.category) {
    fail(
      use.file,
      `"${use.id}"`,
      `clue "${use.value}" is itself an entry in the same category — use a hint for that`,
    );
  }
}

// ── 5. category size ─────────────────────────────────────────────────────────
for (const [category, count] of categoryCounts) {
  if (count < MIN_ENTRIES_PER_CATEGORY) {
    errors.push(
      `  ✗ category "${category}" has only ${count} ${
        count === 1 ? 'entry' : 'entries'
      } — every category needs at least ${MIN_ENTRIES_PER_CATEGORY}`,
    );
  }
}

// ── 6. one pointing per word ─────────────────────────────────────────────────
for (const { file, id, hint } of allHints) {
  const canonical = pointedByPlain.get(stripNiqqud(hint).trim());
  if (canonical && canonical !== normalize(hint)) {
    fail(
      file,
      `"${id}"`,
      `hint "${hint}" must be pointed exactly like the entry it matches: "${canonical}"`,
    );
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const written = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);

if (emptyFiles.length > 0) {
  notes.push(
    `${emptyFiles.length} categor${emptyFiles.length === 1 ? 'y' : 'ies'} not written yet: ${emptyFiles.join(', ')}`,
  );
}

console.log(`מאמת מחסן מילים — ${files.length} קבצים, ${totalEntries} ערכים\n`);
for (const [category, count] of written) {
  const mark = count >= 50 ? '✓' : '·';
  console.log(`  ${mark} ${category.padEnd(16, ' ')} ${count}`);
}
if (notes.length > 0) {
  console.log('');
  for (const note of notes) console.log(`  ℹ ${note}`);
}

if (errors.length > 0) {
  console.error(`\n${errors.length} שגיאות:\n`);
  for (const error of errors) console.error(error);
  console.error('');
  process.exit(1);
}

console.log(`\n✓ המחסן תקין (${totalEntries} ערכים, ${categoryCounts.size} קטגוריות)\n`);
