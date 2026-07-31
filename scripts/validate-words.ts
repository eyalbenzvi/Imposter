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
 *   5. a category with fewer than 4 entries (the guess screen needs 4 options)
 *
 * Plus two consistency checks that keep the pointing honest:
 *   6. a hint that also exists as an entry must be spelled and pointed identically
 *   7. every string must already be NFC-normalized
 */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { hasNiqqud, normalize, stripNiqqud } from '../src/game/niqqud.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORDS_DIR = join(HERE, '..', 'src', 'game', 'words');
const HINTS_REQUIRED = 5;
const MIN_ENTRIES_PER_CATEGORY = 4;

type RawEntry = {
  id?: unknown;
  word?: unknown;
  hints?: unknown;
  category?: unknown;
};

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
    }

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
  });
}

// ── 5. category size ─────────────────────────────────────────────────────────
for (const [category, count] of categoryCounts) {
  if (count < MIN_ENTRIES_PER_CATEGORY) {
    errors.push(
      `  ✗ category "${category}" has only ${count} ${
        count === 1 ? 'entry' : 'entries'
      } — the imposter guess screen needs at least ${MIN_ENTRIES_PER_CATEGORY}`,
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
