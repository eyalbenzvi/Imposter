import type { ReactNode } from 'react';

/**
 * The pointed word, as the hero of the screen — this gets read across a room
 * while the phone is passed around.
 *
 * Sizing is clamp()-based so a long word shrinks instead of wrapping badly, and
 * there is deliberately no fixed height and no overflow:hidden anywhere near
 * it: niqqud sit above and below the glyphs and would be sheared off.
 */
export function WordHero({ word, sub }: { word: string; sub?: ReactNode }) {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <p
        dir="rtl"
        lang="he"
        className="niqqud-hero w-full text-center font-display font-bold text-slate-50"
        style={{
          fontSize: 'clamp(3rem, 18vw, 6.5rem)',
          textShadow: '0 0 42px rgba(167,139,250,0.30)',
        }}
      >
        {word}
      </p>
      {sub && <div className="niqqud text-center text-base text-slate-400">{sub}</div>}
    </div>
  );
}

/** A medium-sized pointed word, for lists and result screens. */
export function WordChip({
  word,
  label,
  tone = 'neutral',
}: {
  word: string;
  label?: string;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  const ring =
    tone === 'good'
      ? 'border-safe/50 bg-safe/10'
      : tone === 'bad'
        ? 'border-danger/50 bg-danger/10'
        : 'border-ink-600 bg-ink-850/70';

  return (
    <div className={`rounded-2xl border px-4 py-3 text-center ${ring}`}>
      {label && (
        <p className="pb-0.5 text-xs font-semibold tracking-[0.04em] text-slate-400">
          {label}
        </p>
      )}
      <p
        dir="rtl"
        lang="he"
        className="niqqud font-display text-2xl font-bold text-slate-50"
      >
        {word}
      </p>
    </div>
  );
}
