import { useCallback, useEffect, useRef, useState } from 'react';
import type { RevealView } from '../../game/types';
import { WordHero } from './WordHero';

/**
 * ANTI-LEAK SCREEN — read this before changing anything here.
 *
 * Two separate guarantees live on this screen.
 *
 * 1. A bystander must not be able to read a role off the *shape* of the screen
 *    or off how long it stays up:
 *    • In HIDDEN mode every player gets a byte-identical screen. The role row is
 *      rendered with `invisible` (visibility:hidden), so it still occupies its
 *      line and the layout cannot shift.
 *    • In KNOWN mode the wording differs, but the frame is the same: same rows,
 *      same font sizes, same paddings, same animation, same minimum hold.
 *
 * 2. Each player must be able to trust that *only they* saw their own word.
 *    • The word is only on screen while a finger is held down. Let go — by
 *      lifting, sliding off, or the browser stealing focus — and it is gone
 *      instantly. The phone can never be handed on with a word still showing.
 *    • Every uncovering is counted in `state.revealViews`. The count is shown
 *      here live, and the group can audit the totals afterwards. Because
 *      SHOW_ROLE is idempotent and the flow never goes back, the count is
 *      always exactly 1 — a second look is impossible, not merely discouraged.
 */

/** Identical for every role, so hold time can never give a role away. */
const MIN_HOLD_MS = 900;

export function RevealCard({
  view,
  position,
  total,
  views,
  onHide,
}: {
  view: RevealView;
  position: number;
  total: number;
  /** Times this player has uncovered their word — 1 by construction. */
  views: number;
  onHide: () => void;
}) {
  const [held, setHeld] = useState(false);
  const [heldLongEnough, setHeldLongEnough] = useState(false);
  const holdTimer = useRef<number | null>(null);

  const release = useCallback(() => {
    setHeld(false);
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const press = useCallback(() => {
    setHeld(true);
    if (holdTimer.current === null) {
      holdTimer.current = window.setTimeout(() => setHeldLongEnough(true), MIN_HOLD_MS);
    }
  }, []);

  // Anything that takes the screen away from the player also hides the word:
  // a background tab, a phone call, the app switcher.
  useEffect(() => {
    const drop = () => release();
    window.addEventListener('blur', drop);
    document.addEventListener('visibilitychange', drop);
    return () => {
      window.removeEventListener('blur', drop);
      document.removeEventListener('visibilitychange', drop);
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    };
  }, [release]);

  const isImposter = view.kind === 'IMPOSTER';
  const roleLine = isImposter ? 'אַתָּה הַמִּתְחַזֶּה' : 'הַמִּלָּה שֶׁלְּךָ';
  const subLine = isImposter
    ? 'זו מילת התחליף — היעזרו בה כדי להשתלב'
    : 'שמרו עליה. אמרו רק מילה אחת שקשורה אליה';

  return (
    <div className="flex min-h-0 w-full flex-1 animate-fade-in flex-col">
      {/* Name and counter both sit at the start edge: the end edge is where the
          fixed home button lives on every screen. */}
      <div className="flex shrink-0 items-center gap-2 pe-14 pb-1 text-sm text-slate-400">
        <span className="niqqud truncate">{view.playerName}</span>
        <span className="num">
          {position} / {total}
        </span>
      </div>

      {/* The panel is sized by its content, identically for every role —
          nothing here may depend on `kind` except colour and wording. */}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div
          onPointerDown={press}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={release}
          onContextMenu={(e) => e.preventDefault()}
          role="button"
          tabIndex={0}
          aria-label="החזיקו כדי לראות את המילה"
          className={`relative flex w-full cursor-pointer select-none touch-none flex-col items-center
            justify-center gap-5 rounded-[2rem] border px-4 py-12 transition-colors ${
              isImposter
                ? 'border-danger/40 bg-danger/[0.06] shadow-2xl shadow-danger/10'
                : 'border-glow/30 bg-glow/[0.05] shadow-2xl shadow-glow-deep/10'
            }`}
        >
          {/* Role row — same line, same size for every role. */}
          <p
            className={`niqqud text-center text-lg font-bold ${
              !held || view.kind === 'PLAIN'
                ? 'invisible'
                : isImposter
                  ? 'text-danger'
                  : 'text-glow-soft'
            }`}
          >
            {view.kind === 'PLAIN' ? 'הַמִּלָּה שֶׁלְּךָ' : roleLine}
          </p>

          {/* The word keeps its exact box whether or not it is visible, so
              nothing shifts when the finger lands or lifts. */}
          <div className={held ? '' : 'invisible'}>
            <WordHero word={view.word} tone={isImposter ? 'imposter' : 'neutral'} />
          </div>

          {/* Sub row — always exactly two lines' worth of space. */}
          <p
            className={`min-h-[3rem] max-w-[26ch] text-center text-sm leading-relaxed ${
              !held
                ? 'invisible'
                : view.kind === 'PLAIN'
                  ? 'text-slate-400'
                  : 'text-slate-300'
            }`}
          >
            {view.kind === 'PLAIN'
              ? 'זכרו את המילה. בתורכם אמרו מילה אחת שקשורה אליה'
              : subLine}
          </p>

          {/* Cover — occupies the panel, never changes its size. */}
          {!held && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <span
                aria-hidden
                className="grid h-16 w-16 place-items-center rounded-full border border-glow/40 bg-glow/10 text-2xl"
              >
                👁
              </span>
              <p className="text-lg font-bold text-slate-200">
                לחצו והחזיקו כדי לראות
              </p>
              <p className="max-w-[24ch] text-sm leading-relaxed text-slate-400">
                המילה תוצג רק כל זמן שהאצבע על המסך. ברגע שתרפו — היא נעלמת
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 pt-3">
        {/* The audit line: this player's word was uncovered exactly this many
            times, and the group sees the same totals at the end of the handout. */}
        <p className="pb-2 text-center text-xs text-slate-500">
          {views === 1 ? (
            <>
              נחשף <span className="num font-bold text-safe">1</span> פעם — רק אתם
              ראיתם אותה
            </>
          ) : (
            <>
              נחשף <span className="num font-bold text-gold">{views}</span> פעמים
            </>
          )}
        </p>
        <button
          type="button"
          onClick={onHide}
          disabled={!heldLongEnough}
          className="btn-primary w-full"
        >
          {heldLongEnough ? 'הבנתי, העבירו הלאה' : 'החזיקו כדי לראות'}
        </button>
      </div>
    </div>
  );
}
