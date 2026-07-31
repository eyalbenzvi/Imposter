import { useEffect, useState } from 'react';
import type { RevealView } from '../../game/types';
import { WordHero } from './WordHero';

/**
 * ANTI-LEAK SCREEN — read this before changing anything here.
 *
 * A spectator standing next to the player must not be able to tell a role from
 * the *shape* of the screen or from how long it stays up.
 *
 * • In HIDDEN mode every player gets a byte-identical screen. The role row is
 *   rendered with `invisible` (visibility:hidden), so it still occupies its
 *   line and the layout cannot shift.
 * • In KNOWN mode the wording differs, but the frame is the same: same rows,
 *   same font sizes, same paddings, same animation, same minimum dwell time.
 * • The "hide" button unlocks after the SAME delay for everyone, so nobody can
 *   be identified by a screen that vanished unusually fast.
 */

/** Identical for every role, so dwell time can never give a role away. */
const UNLOCK_MS = 900;

export function RevealCard({
  view,
  position,
  total,
  onHide,
}: {
  view: RevealView;
  position: number;
  total: number;
  onHide: () => void;
}) {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    setUnlocked(false);
    const id = window.setTimeout(() => setUnlocked(true), UNLOCK_MS);
    return () => window.clearTimeout(id);
  }, [view.playerName]);

  const isImposter = view.kind === 'IMPOSTER';

  // One row per slot, always present. HIDDEN mode fills them with neutral text.
  const roleLine = isImposter ? 'אַתָּה הַמִּתְחַזֶּה' : 'הַמִּלָּה שֶׁלְּךָ';
  const subLine = isImposter
    ? 'זו מילת התחליף — היעזרו בה כדי להשתלב'
    : 'שמרו עליה. אמרו רק מילה אחת שקשורה אליה';

  return (
    <div className="flex min-h-0 w-full flex-1 animate-fade-in flex-col">
      <div className="flex shrink-0 items-center justify-between pb-1 text-sm text-slate-400">
        <span>{view.playerName}</span>
        <span className="num">
          {position} / {total}
        </span>
      </div>

      {/* The panel is centred and sized by its content, identically for every
          role — nothing here may depend on `kind` except colour and wording. */}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div
          className={`flex w-full flex-col items-center justify-center gap-5 rounded-[2rem] border px-4 py-12 ${
            isImposter
              ? 'border-danger/40 bg-danger/[0.06] shadow-2xl shadow-danger/10'
              : 'border-glow/30 bg-glow/[0.05] shadow-2xl shadow-glow-deep/10'
          }`}
        >
          {/* Role row — same line, same size for every role. */}
          <p
            className={`niqqud text-center text-lg font-bold ${
              view.kind === 'PLAIN'
                ? 'invisible'
                : isImposter
                  ? 'text-danger'
                  : 'text-glow-soft'
            }`}
          >
            {view.kind === 'PLAIN' ? 'הַמִּלָּה שֶׁלְּךָ' : roleLine}
          </p>

          <WordHero word={view.word} tone={isImposter ? 'imposter' : 'neutral'} />

          {/* Sub row — always exactly two lines' worth of space. */}
          <p
            className={`min-h-[3rem] max-w-[26ch] text-center text-sm leading-relaxed ${
              view.kind === 'PLAIN' ? 'text-slate-400' : 'text-slate-300'
            }`}
          >
            {view.kind === 'PLAIN'
              ? 'זכרו את המילה. בתורכם אמרו מילה אחת שקשורה אליה'
              : subLine}
          </p>
        </div>
      </div>

      <div className="shrink-0 pt-3">
        <button
          type="button"
          onClick={onHide}
          disabled={!unlocked}
          className="btn-primary w-full"
        >
          {unlocked ? 'הבנתי, הסתר' : 'רק רגע…'}
        </button>
      </div>
    </div>
  );
}
