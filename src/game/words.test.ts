import { describe, expect, it } from 'vitest';
import { CATEGORIES, WORDS, getWordEntry, wordsInCategory } from './words';
import { hasNiqqud, normalize, stripNiqqud } from './niqqud';
import { HINTS_PER_WORD } from './types';

describe('word store', () => {
  it('is not empty', () => {
    expect(WORDS.length).toBeGreaterThan(0);
    expect(CATEGORIES.length).toBeGreaterThan(0);
  });

  it('gives every entry exactly five hints', () => {
    for (const entry of WORDS) {
      expect(entry.hints, entry.id).toHaveLength(HINTS_PER_WORD);
    }
  });

  it('points every word and every hint', () => {
    for (const entry of WORDS) {
      expect(hasNiqqud(entry.word), `${entry.id}: ${entry.word}`).toBe(true);
      for (const hint of entry.hints) {
        expect(hasNiqqud(hint), `${entry.id}: ${hint}`).toBe(true);
      }
    }
  });

  it('stores everything NFC-normalized', () => {
    for (const entry of WORDS) {
      expect(normalize(entry.word)).toBe(entry.word);
      for (const hint of entry.hints) expect(normalize(hint)).toBe(hint);
    }
  });

  it('has unique ids and unique words across categories', () => {
    expect(new Set(WORDS.map((w) => w.id)).size).toBe(WORDS.length);
    expect(new Set(WORDS.map((w) => stripNiqqud(w.word))).size).toBe(WORDS.length);
  });

  it('never repeats a hint inside an entry or echoes the word itself', () => {
    for (const entry of WORDS) {
      const plain = entry.hints.map((h) => stripNiqqud(h));
      expect(new Set(plain).size, entry.id).toBe(HINTS_PER_WORD);
      expect(plain).not.toContain(stripNiqqud(entry.word));
    }
  });

  it('points a hint exactly like the entry it matches', () => {
    const pointedByPlain = new Map(WORDS.map((w) => [stripNiqqud(w.word), w.word]));
    for (const entry of WORDS) {
      for (const hint of entry.hints) {
        const canonical = pointedByPlain.get(stripNiqqud(hint));
        if (canonical) expect(hint, `${entry.id} → ${hint}`).toBe(canonical);
      }
    }
  });

  it('keeps every category big enough for a 4-option guess screen', () => {
    for (const category of CATEGORIES) {
      expect(wordsInCategory(category).length, category).toBeGreaterThanOrEqual(4);
    }
  });

  it('looks up entries by id and rejects unknown ones', () => {
    const first = WORDS[0]!;
    expect(getWordEntry(first.id)).toBe(first);
    expect(() => getWordEntry('nope-not-a-word')).toThrow();
  });
});
