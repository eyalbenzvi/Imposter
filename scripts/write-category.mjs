/**
 * Authoring helper for the word store. Run with:
 *   node scripts/write-category.mjs <file> <category> <<'EOF'
 *   id | word | hint1 | hint2 | hint3 | hint4 | hint5
 *   ...
 *   EOF
 *
 * It only formats and normalizes — `npm run validate:words` is what actually
 * checks the content. Kept in the repo so a later session can extend a
 * category the same way the earlier ones were written.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [file, category] = process.argv.slice(2);
if (!file || !category) {
  console.error('usage: node scripts/write-category.mjs <file.json> <category>');
  process.exit(1);
}

const stdin = await new Promise((resolve) => {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (buffer += chunk));
  process.stdin.on('end', () => resolve(buffer));
});

const entries = stdin
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'))
  .map((line, index) => {
    const parts = line.split('|').map((part) => part.trim().normalize('NFC'));
    if (parts.length !== 7) {
      throw new Error(`line ${index + 1}: expected "id | word | 5 hints", got ${parts.length} fields\n  ${line}`);
    }
    const [id, word, ...hints] = parts;
    return { id, word, hints, category: category.normalize('NFC') };
  });

const json =
  '[\n' +
  entries
    .map(
      (e) =>
        `  { "id": ${JSON.stringify(e.id)}, "word": ${JSON.stringify(e.word)}, "hints": [${e.hints
          .map((h) => JSON.stringify(h))
          .join(', ')}], "category": ${JSON.stringify(e.category)} }`,
    )
    .join(',\n') +
  '\n]\n';

const target = join('src', 'game', 'words', file);
writeFileSync(target, json, 'utf8');
console.log(`${target}: ${entries.length} entries`);
