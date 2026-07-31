import { describe, expect, it } from 'vitest';
import { hasNiqqud, normalize, sameWord, stripNiqqud } from './niqqud';

describe('stripNiqqud', () => {
  it('removes vowel points', () => {
    expect(stripNiqqud('פִּיצָה')).toBe('פיצה');
    expect(stripNiqqud('הַמְבּוּרְגֶּר')).toBe('המבורגר');
  });

  it('removes shva', () => {
    expect(stripNiqqud('שְׁנִיצֶל')).toBe('שניצל');
    expect(stripNiqqud('גְּבִינָה')).toBe('גבינה');
  });

  it('removes dagesh, including doubled marks on one letter', () => {
    // The yod here carries both a dagesh and a qamats.
    expect(stripNiqqud('סֻפְגָּנִיָּה')).toBe('ספגניה');
    expect(stripNiqqud('חַלָּה')).toBe('חלה');
  });

  it('removes the shin dot and the sin dot', () => {
    expect(stripNiqqud('שֻׁלְחָן')).toBe('שלחן'); // shin dot (right)
    expect(stripNiqqud('שָׂדֶה')).toBe('שדה'); // sin dot (left)
    expect(stripNiqqud('שִׂמְחָה')).toBe('שמחה');
  });

  it('keeps a vav that is a letter but drops holam and qubuts marks', () => {
    // Defective spelling: qubuts is a mark, so nothing is left behind.
    expect(stripNiqqud('אֹרֶז')).toBe('ארז');
    expect(stripNiqqud('סֻכָּרִיָּה')).toBe('סכריה');
    // Full spelling: the vav is a real letter and survives.
    expect(stripNiqqud('חוּמוּס')).toBe('חומוס');
    expect(stripNiqqud('שׁוֹקוֹלָד')).toBe('שוקולד');
  });

  it('removes meteg and cantillation marks', () => {
    expect(stripNiqqud('בְּרֵאשִׁ֖ית')).toBe('בראשית');
  });

  it('leaves unpointed text untouched', () => {
    expect(stripNiqqud('פיצה')).toBe('פיצה');
    expect(stripNiqqud('pizza')).toBe('pizza');
  });

  it('keeps a geresh, which is a letter modifier and not niqqud', () => {
    expect(stripNiqqud("צִ'יפְּס")).toBe("צ'יפס");
  });

  it('normalizes to NFC before stripping', () => {
    const decomposed = 'פִּיצָה'.normalize('NFD');
    expect(stripNiqqud(decomposed)).toBe('פיצה');
  });
});

describe('hasNiqqud', () => {
  it('is true for pointed words', () => {
    expect(hasNiqqud('פִּיצָה')).toBe(true);
    expect(hasNiqqud('שְׁנִיצֶל')).toBe(true);
  });

  it('is false for bare text', () => {
    expect(hasNiqqud('פיצה')).toBe(false);
    expect(hasNiqqud("צ'יפס")).toBe(false);
    expect(hasNiqqud('')).toBe(false);
  });
});

describe('sameWord', () => {
  it('ignores niqqud and surrounding space', () => {
    expect(sameWord('פִּיצָה', ' פיצה ')).toBe(true);
    expect(sameWord('גְּלִידָה', 'גלידה')).toBe(true);
  });

  it('still separates genuinely different words', () => {
    expect(sameWord('פִּיצָה', 'פַּסְטָה')).toBe(false);
  });
});

describe('normalize', () => {
  it('produces NFC', () => {
    const nfd = 'שַׁקְשׁוּקָה'.normalize('NFD');
    expect(normalize(nfd)).toBe('שַׁקְשׁוּקָה'.normalize('NFC'));
  });
});
