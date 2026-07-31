/**
 * The word store.
 *
 * One JSON file per category. Nothing in the app assumes a particular number
 * of entries or categories — the game works fine against a partially filled
 * store, it just draws from whatever is here.
 *
 * Every string in these files is fully pointed and NFC-normalized. Comparisons
 * never happen on the raw strings; they go through `stripNiqqud`.
 */

import type { WordEntry } from '../types';
import { stripNiqqud } from '../niqqud';

import food from './food.json';
import drinks from './drinks.json';
import produce from './produce.json';
import animals from './animals.json';
import professions from './professions.json';
import household from './household.json';
import kitchen from './kitchen.json';
import clothing from './clothing.json';
import city from './city.json';
import nature from './nature.json';
import sports from './sports.json';
import transport from './transport.json';
import instruments from './instruments.json';
import body from './body.json';
import weather from './weather.json';
import tools from './tools.json';
import tech from './tech.json';
import school from './school.json';
import holidays from './holidays.json';
import feelings from './feelings.json';

const FILES: WordEntry[][] = [
  food,
  drinks,
  produce,
  animals,
  professions,
  household,
  kitchen,
  clothing,
  city,
  nature,
  sports,
  transport,
  instruments,
  body,
  weather,
  tools,
  tech,
  school,
  holidays,
  feelings,
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

/** Niqqud-insensitive lookup, used by tests and the validator. */
export function findByPlainWord(plain: string): WordEntry | undefined {
  const key = stripNiqqud(plain);
  return WORDS.find((w) => stripNiqqud(w.word) === key);
}
