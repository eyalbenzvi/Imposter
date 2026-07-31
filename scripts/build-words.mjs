/**
 * Builds `src/game/words/*.json` from the plain-text sources in
 * `scripts/kidwords/`. Run with `npm run build:words`.
 *
 * Why the indirection. Niqqud is the part that is easy to get subtly wrong, and
 * every word appears once as an entry and up to five more times as somebody
 * else's hint. Here a word is pointed in exactly one place — its own entry line —
 * and hints are written as *ids*, resolved against the same file. So a hint can
 * never be pointed differently from the entry it names, and it can never point
 * outside its own category: siblings by construction, not by discipline.
 *
 * Source format (`#` starts a comment, `@category` names the category):
 *
 *   @category חיות
 *   dog | כֶּלֶב | cat | cow | horse | rabbit | sheep
 *
 * The word column is either fully pointed Hebrew (a new word) or plain Hebrew
 * (reuse the pointing already recorded in `kidwords/lexicon.json`, which was
 * seeded from the previous store). Nothing is written unless every file is good.
 *
 * KNOWN-mode clues live apart, in `kidwords/clues/<same-name>.txt`, one line per
 * entry keyed by the same id:
 *
 *   dog | נֶאֱמָנוּת | רְצוּעָה | נוֹבֵחַ
 *
 * in the order pair | related | trait. They sit in their own file because they
 * are a different kind of writing from the sibling lists, and because a clue is
 * free text rather than a pointer at another entry.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'kidwords');
const OUT = join(HERE, '..', 'src', 'game', 'words');
const NIQQUD = /[֑-ׇ]/g;
// Separate non-global copy: `test` on a /g regex carries lastIndex between calls.
const HAS_NIQQUD = /[֑-ׇ]/;
const HINTS_REQUIRED = 5;

const strip = (s) => s.replace(NIQQUD, '');
const nfc = (s) => s.normalize('NFC');

/** plain → pointed, from the previous store. Only consulted for plain words. */
const lexicon = new Map();
{
  const raw = JSON.parse(readFileSync(join(SRC, 'lexicon.json'), 'utf8'));
  for (const [plain, pointed] of Object.entries(raw)) {
    lexicon.set(nfc(strip(plain)), nfc(pointed));
  }
}

const problems = [];
const unpointed = new Set();
const parsed = [];

const CLUE_FIELDS = ['pair', 'related', 'trait'];

/** id → {pair, related, trait} for one category file, or an empty map. */
function readClues(file) {
  const path = join(SRC, 'clues', file);
  if (!existsSync(path)) return new Map();
  const out = new Map();
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) return;
      const where = `clues/${file}:${i + 1}`;
      const parts = line.split('|').map((p) => nfc(p.trim()));
      if (parts.length !== 1 + CLUE_FIELDS.length) {
        problems.push(
          `${where}: expected "id | pair | related | trait", got ${parts.length} fields`,
        );
        return;
      }
      const [id, ...values] = parts;
      if (out.has(id)) {
        problems.push(`${where}: duplicate id "${id}"`);
        return;
      }
      const clues = {};
      values.forEach((value, k) => {
        if (!HAS_NIQQUD.test(value)) {
          const known = lexicon.get(strip(value));
          if (!known) {
            unpointed.add(`${value}  (${where})`);
            problems.push(`${where}: "${value}" has no niqqud and is not in the lexicon`);
            return;
          }
          clues[CLUE_FIELDS[k]] = known;
          return;
        }
        clues[CLUE_FIELDS[k]] = value;
      });
      out.set(id, clues);
    });
  return out;
}

for (const file of readdirSync(SRC).filter((f) => f.endsWith('.txt')).sort()) {
  const lines = readFileSync(join(SRC, file), 'utf8').split('\n');
  let category = null;
  const rows = [];

  lines.forEach((raw, i) => {
    const line = raw.trim();
    const where = `${file}:${i + 1}`;
    if (line === '') return;
    if (line.startsWith('@category')) {
      category = nfc(line.slice('@category'.length).trim());
      return;
    }
    if (line.startsWith('#')) return;
    if (category === null) {
      problems.push(`${where}: entry before the @category line`);
      return;
    }

    const parts = line.split('|').map((p) => nfc(p.trim()));
    if (parts.length !== 2 + HINTS_REQUIRED) {
      problems.push(
        `${where}: expected "id | word | ${HINTS_REQUIRED} hint ids", got ${parts.length} fields`,
      );
      return;
    }
    const [id, wordColumn, ...hintIds] = parts;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      problems.push(`${where}: "${id}" is not a lowercase latin slug`);
      return;
    }

    let word = wordColumn;
    if (!HAS_NIQQUD.test(wordColumn)) {
      const known = lexicon.get(strip(wordColumn));
      if (!known) {
        unpointed.add(`${wordColumn}  (${file} → ${id})`);
        problems.push(`${where}: "${wordColumn}" has no niqqud and is not in the lexicon`);
        return;
      }
      word = known;
    }
    rows.push({ id, word, hintIds, category, where });
  });

  if (rows.length === 0) {
    problems.push(`${file}: no entries`);
    continue;
  }
  parsed.push({ file, category, rows });
}

// ── resolve hint ids inside their own file ───────────────────────────────────
const built = [];
let withClues = 0;
for (const { file, category, rows } of parsed) {
  const clueRows = readClues(file);
  for (const id of clueRows.keys()) {
    if (!rows.some((r) => r.id === id)) {
      problems.push(`clues/${file}: "${id}" is not an entry in ${file}`);
    }
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (byId.size !== rows.length) {
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.id)) problems.push(`${r.where}: duplicate id "${r.id}" in this file`);
      seen.add(r.id);
    }
  }

  const entries = rows.map((row) => {
    const hints = [];
    const used = new Set();
    for (const hintId of row.hintIds) {
      const target = byId.get(hintId);
      if (!target) {
        problems.push(`${row.where}: hint "${hintId}" is not an id in ${file}`);
        continue;
      }
      if (hintId === row.id) {
        problems.push(`${row.where}: hint "${hintId}" is the entry itself`);
        continue;
      }
      if (used.has(hintId)) {
        problems.push(`${row.where}: hint "${hintId}" is listed twice`);
        continue;
      }
      used.add(hintId);
      hints.push(target.word);
    }
    const clues = clueRows.get(row.id);
    if (clues) withClues++;
    return clues
      ? { id: row.id, word: row.word, hints, clues, category }
      : { id: row.id, word: row.word, hints, category };
  });

  built.push({ out: basename(file, '.txt') + '.json', category, entries });
}

if (problems.length > 0) {
  console.error(`✗ ${problems.length} problem(s) — nothing written\n`);
  for (const p of problems.slice(0, 80)) console.error(`  ${p}`);
  if (problems.length > 80) console.error(`  … and ${problems.length - 80} more`);
  if (unpointed.size > 0) {
    console.error(`\nWords needing niqqud inline or in lexicon.json (${unpointed.size}):`);
    for (const u of unpointed) console.error(`  ${u}`);
  }
  process.exit(1);
}

for (const { out, entries } of built) {
  const json =
    '[\n' +
    entries
      .map(
        (e) =>
          `  { "id": ${JSON.stringify(e.id)}, "word": ${JSON.stringify(e.word)}, ` +
          `"hints": [${e.hints.map((h) => JSON.stringify(h)).join(', ')}], ` +
          (e.clues
            ? `"clues": { ${CLUE_FIELDS.map(
                (k) => `${JSON.stringify(k)}: ${JSON.stringify(e.clues[k])}`,
              ).join(', ')} }, `
            : '') +
          `"category": ${JSON.stringify(e.category)} }`,
      )
      .join(',\n') +
    '\n]\n';
  writeFileSync(join(OUT, out), json, 'utf8');
}

let total = 0;
for (const { out, category, entries } of built) {
  total += entries.length;
  const clued = entries.filter((e) => e.clues).length;
  const flag = clued === entries.length ? '✓' : `${clued}/${entries.length} clues`;
  console.log(
    `  ${String(entries.length).padStart(4)}  ${category.padEnd(26)} ${out.padEnd(15)} ${flag}`,
  );
}
console.log(
  `\n✓ ${total} entries across ${built.length} categories, ${withClues} with KNOWN-mode clues`,
);
