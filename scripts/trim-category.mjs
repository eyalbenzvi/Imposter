/**
 * Drop entries from a category and repair any hint list that referenced them.
 *
 *   node scripts/trim-category.mjs household.json id1,id2 -- fallback1 fallback2 ...
 *
 * A dropped word is swapped for the first fallback that is not already in that
 * hint list and is not the entry's own word, so hints stay 5-long and unique.
 * `npm run validate:words` still has the final say on the result.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const [file, ids] = argv.slice(0, split === -1 ? undefined : split);
const fallbacks = split === -1 ? [] : argv.slice(split + 1);

if (!file || !ids) {
  console.error('usage: node scripts/trim-category.mjs <file.json> <id,id> -- <fallback words>');
  process.exit(1);
}

const target = join('src', 'game', 'words', file);
const entries = JSON.parse(readFileSync(target, 'utf8'));
const dropIds = new Set(ids.split(','));
const dropped = entries.filter((e) => dropIds.has(e.id)).map((e) => e.word);
const kept = entries.filter((e) => !dropIds.has(e.id));

for (const entry of kept) {
  const hints = [];
  for (const hint of entry.hints) {
    if (!dropped.includes(hint)) {
      hints.push(hint);
      continue;
    }
    const replacement = fallbacks.find(
      (word) => word !== entry.word && !hints.includes(word) && !entry.hints.includes(word),
    );
    if (!replacement) {
      throw new Error(`no fallback left for "${entry.id}" (dropped hint ${hint})`);
    }
    hints.push(replacement);
  }
  entry.hints = hints;
}

const json =
  '[\n' +
  kept
    .map(
      (e) =>
        `  { "id": ${JSON.stringify(e.id)}, "word": ${JSON.stringify(e.word)}, "hints": [${e.hints
          .map((h) => JSON.stringify(h))
          .join(', ')}], "category": ${JSON.stringify(e.category)} }`,
    )
    .join(',\n') +
  '\n]\n';

writeFileSync(target, json, 'utf8');
console.log(`${target}: dropped ${dropped.join(', ')} → ${kept.length} entries`);
