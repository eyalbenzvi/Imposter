/**
 * Niqqud helpers.
 *
 * Hebrew niqqud are Unicode combining marks in the range U+0591–U+05C7
 * (cantillation, points, dagesh, shin/sin dots, meteg, rafe, maqaf-adjacent
 * marks). They are *never* stored separately from the word — every comparison
 * in the game strips them at runtime instead.
 */

/** Combining marks that make up Hebrew pointing. */
export const NIQQUD_RANGE = /[֑-ׇ]/;

const NIQQUD_GLOBAL = /[֑-ׇ]/g;

/** Normalize to NFC so combining marks always sit in canonical order. */
export function normalize(s: string): string {
  return s.normalize('NFC');
}

/**
 * Remove every niqqud mark. This is the ONLY way the game compares Hebrew
 * strings — equality, dedup, search and answer checking all route through it.
 * There is deliberately no parallel `plain` column in the data.
 */
export function stripNiqqud(s: string): string {
  return normalize(s).replace(NIQQUD_GLOBAL, '');
}

/** True when the string carries at least one niqqud mark. */
export function hasNiqqud(s: string): boolean {
  return NIQQUD_RANGE.test(normalize(s));
}

/** Niqqud-insensitive, whitespace-tolerant equality. */
export function sameWord(a: string, b: string): boolean {
  return stripNiqqud(a).trim() === stripNiqqud(b).trim();
}
