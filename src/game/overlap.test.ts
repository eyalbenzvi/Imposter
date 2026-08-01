import { describe, expect, it } from 'vitest';
import { OVERLAP_REASON, overlap, skeleton, stemCandidates } from './overlap';

describe('skeleton', () => {
  it('drops the pointing and folds final letters', () => {
    expect(skeleton('כֶּלֶב')).toBe('כלב');
    expect(skeleton('לֶחֶם')).toBe('לחמ');
    expect(skeleton('אָרוֹן')).toBe('ארונ');
  });

  it('breaks on maqaf, which the pointing would otherwise swallow', () => {
    expect(skeleton('בֵּית־סֵפֶר')).toBe('בית ספר');
    expect(skeleton('  תַּחֲנַת   אוֹטוֹבּוּס ')).toBe('תחנת אוטובוס');
  });

  it('does not break on geresh — it modifies a letter, it is not a space', () => {
    expect(skeleton("גִּ'ינְס")).toBe('גינס');
    expect(skeleton("גִּ'ירָפָה")).toBe('גירפה');
    // Splitting there would leave a bare ג that every other ג' word matches.
    expect(overlap("גִּ'ינְס", "גִּ'ירָפָה")).toBeNull();
  });
});

describe('stemCandidates', () => {
  it('branches on the prefix instead of deciding, so both readings survive', () => {
    // כ is a preposition and also the first root letter of כ־ת־ב. Stripping it
    // greedily would leave כתיבה as תיב and never meet כותב's כתב.
    expect(stemCandidates('כתיבה')).toContain('כתב');
    expect(stemCandidates('כותב')).toContain('כתב');
    expect(stemCandidates('הקצפה')).toContain('קצפ');
    expect(stemCandidates('קצפת')).toContain('קצפ');
  });

  it('never produces anything shorter than a root', () => {
    for (const token of ['מימ', 'פה', 'יד', 'כלב', 'שמימ']) {
      for (const candidate of stemCandidates(token)) {
        expect(candidate.length, `${token} → ${candidate}`).toBeGreaterThanOrEqual(3);
      }
    }
    // Two letters can reduce to nothing at all — which is exactly why short
    // words never match anything through ROOT.
    expect(stemCandidates('פה').size).toBe(0);
  });
});

describe('overlap', () => {
  it('reports the same word without its pointing', () => {
    expect(overlap('כֶּלֶב', 'כלב')).toBe('SAME');
  });

  it('reports a shared whole word', () => {
    expect(overlap('אוֹטוֹבּוּס', 'תַּחֲנַת אוֹטוֹבּוּס')).toBe('TOKEN');
    expect(overlap('כַּף רֶגֶל', 'אֶצְבַּע רֶגֶל')).toBe('TOKEN');
  });

  it('reports one word spelled inside the other', () => {
    expect(overlap('כֶּלֶב', 'כְּלַבְלַב')).toBe('CONTAIN');
    expect(overlap('לֶחֶם', 'לַחְמָנִיָּה')).toBe('CONTAIN');
  });

  it('sees inside a phrase, not just a bare word', () => {
    // Compared token against token, so a second word cannot hide the overlap.
    expect(overlap('קַטְנוֹעַ', 'קָטָן וְקַל')).toBe('CONTAIN');
    expect(overlap('נַעֲלַיִם', 'נַעֲלֵי סְפּוֹרְט')).toBe('CONTAIN');
    expect(overlap('כַּדּוּרֶגֶל', 'כַּדּוּר יָד')).toBe('CONTAIN');
    expect(overlap('בַּקְבּוּק מַיִם', 'יָמִים רְצוּפִים')).toBe('CONTAIN');
  });

  it('reports two words off one root', () => {
    expect(overlap('קַצֶּפֶת', 'הַקְצָפָה')).toBe('ROOT');
    expect(overlap('פֶּצַע', 'פְּצִיעָה')).toBe('ROOT');
    expect(overlap('תַּרְנְגוֹל', 'תַּרְנְגֹלֶת')).toBe('ROOT');
    expect(overlap('כְּתִיבָה', 'כּוֹתֵב')).toBe('ROOT');
    expect(overlap('מַשְׁרוֹקִית', 'שְׁרִיקָה')).toBe('ROOT');
  });

  it('passes words that only happen to share letters', () => {
    expect(overlap('כֶּלֶב', 'חָתוּל')).toBeNull();
    // Two-letter words turn up inside unrelated ones by chance; the three-letter
    // floor is what keeps those from being reported.
    expect(overlap('פֶּה', 'שָׂפָה')).toBeNull();
    expect(overlap('דֹּב', 'דְּבַשׁ')).toBeNull();
    expect(overlap('צָב', 'צֶבַע')).toBeNull();
  });

  it('is symmetric and safe on blanks', () => {
    expect(overlap('לֶחֶם', 'לַחְמָנִיָּה')).toBe(overlap('לַחְמָנִיָּה', 'לֶחֶם'));
    expect(overlap('', 'כֶּלֶב')).toBeNull();
    expect(overlap('   ', '')).toBeNull();
  });

  it('has a Hebrew reason for every kind it can report', () => {
    for (const kind of ['SAME', 'TOKEN', 'CONTAIN', 'ROOT'] as const) {
      expect(OVERLAP_REASON[kind]).toBeTruthy();
    }
  });
});
