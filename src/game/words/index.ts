/**
 * The word store.
 *
 * Eleven categories, one JSON file each, every word one an 8-year-old actually
 * uses — that goes for the hints too, since a hint a child has never heard is
 * worse than no hint at all. Nothing in the app assumes a particular number of
 * entries or categories: the game works fine against a partially filled store,
 * it just draws from whatever is here.
 *
 * These files are generated — edit `scripts/kidwords/*.txt` and run
 * `npm run build:words`. Hints are written there as ids and resolved inside the
 * same file, so a hint is always a sibling from the same category and can never
 * be pointed differently from the entry it names.
 *
 * Every string is fully pointed and NFC-normalized. Comparisons never happen on
 * the raw strings; they go through `stripNiqqud`.
 */

import type { WordEntry } from '../types';
import { stripNiqqud } from '../niqqud';

import animals from './animals.json';
import food from './food.json';
import plants from './plants.json';
import nature from './nature.json';
import body from './body.json';
import home from './home.json';
import clothing from './clothing.json';
import school from './school.json';
import sports from './sports.json';
import city from './city.json';
import people from './people.json';

const FILES: WordEntry[][] = [
  animals,
  food,
  plants,
  nature,
  body,
  home,
  clothing,
  school,
  sports,
  city,
  people,
];

export const WORDS: WordEntry[] = FILES.flat();

const BY_ID: Record<string, WordEntry> = {};
for (const entry of WORDS) BY_ID[entry.id] = entry;

/** Categories in file order, each with at least one entry. */
export const CATEGORIES: string[] = [...new Set(WORDS.map((w) => w.category))];

export function getWordEntry(id: string): WordEntry {
  const entry = BY_ID[id];
  if (!entry) throw new Error(`Unknown word id: ${id}`);
  return entry;
}

export function findWordEntry(id: string): WordEntry | undefined {
  return BY_ID[id];
}

export function wordsInCategory(category: string): WordEntry[] {
  return WORDS.filter((w) => w.category === category);
}

/**
 * The pool a game draws from. An empty selection, or one naming only categories
 * that no longer exist, means "all of them" — a stored setting from an older
 * build must never leave a group with no words to play.
 */
export function wordsInCategories(categories: readonly string[]): WordEntry[] {
  const wanted = new Set(categories);
  const pool = WORDS.filter((w) => wanted.has(w.category));
  return pool.length > 0 ? pool : WORDS;
}

/** Niqqud-insensitive lookup, used by tests and the validator. */
export function findByPlainWord(plain: string): WordEntry | undefined {
  const key = stripNiqqud(plain);
  return WORDS.find((w) => stripNiqqud(w.word) === key);
}
