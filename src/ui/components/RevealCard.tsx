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
 *    • Every uncovering is counted in `state.revealViews`. Because SHOW_ROLE is
 *      idempotent and the flow never goes back, that count is always exactly 1
 *      — a second look is impossible, not merely discouraged. The number is not
 *      rendered: a counter that can only ever read "1" tells a player nothing
 *      they can act on, so the ledger stays as the enforced invariant behind
 *      the guarantee rather than as UI.
 */

/**
 * How long the word must have been on screen before the player may move on.
 * Identical for every role, so dwell time can never give a role away.
 *
 * This is CUMULATIVE across presses. Requiring one unbroken hold was a bug: a
 * finger drifting off the panel fires pointerleave, which hid the word and
 * threw the progress away, so a player who held twice for 800ms was still
 * locked out and had to keep uncovering the word to get past the button.
 */
const MIN_HOLD_MS = 900;

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
  const [held, setHeld] = useState(false);
  const [heldLongEnough, setHeldLongEnough] = useState(false);
  const holdTimer = useRef<number | null>(null);
  /** Milliseconds this player has already had the word on screen. */
  const heldMs = useRef(0);
  /** When the current press started, or null when nothing is held. */
  const pressedAt = useRef<number | null>(null);

  const release = useCallback(() => {
    setHeld(false);
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    // Bank the time instead of discarding it, so letting go — or a finger
    // slipping off the panel — costs nothing but the word being hidden.
    if (pressedAt.current !== null) {
      heldMs.current += Date.now() - pressedAt.current;
      pressedAt.current = null;
    }
  }, []);

  const press = useCallback(() => {
    setHeld(true);
    if (pressedAt.current === null) pressedAt.current = Date.now();
    if (holdTimer.current === null) {
      const left = Math.max(0, MIN_HOLD_MS - heldMs.current);
      holdTimer.current = window.setTimeout(() => {
        setHeldLongEnough(true);
        holdTimer.current = null;
      }, left);
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
          onPointerDown={(e) => {
            // Capture the pointer so a slight drift doesn't fire pointerleave
            // and hide the word out from under the player.
            e.currentTarget.setPointerCapture?.(e.pointerId);
            press();
          }}
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
