import { useState } from 'react';
import type { Game } from '../useGame';

/**
 * Always-present way out. Fixed to the end-side top corner so it sits in the
 * same place on every screen of a running game, including the reveal flow —
 * ending the round is safe there, unlike a back button, which would let someone
 * return to a previous player's word.
 *
 * It confirms first, because it throws the round away. Player names and
 * settings survive.
 */
export function HomeButton({ game }: { game: Game }) {
  const [asking, setAsking] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-label="סיום המשחק וחזרה למסך הפתיחה"
        className="fixed z-40 grid h-11 w-11 place-items-center rounded-xl border
          border-ink-700 bg-ink-900/80 text-lg text-slate-400 backdrop-blur
          transition active:scale-95 hover:border-danger/60 hover:text-danger"
        style={{
          // Logical inset: the end side is the left in an RTL document.
          insetInlineEnd: 'max(0.75rem, env(safe-area-inset-right))',
          top: 'max(0.75rem, env(safe-area-inset-top))',
        }}
      >
        ⌂
      </button>

      {asking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/85 p-6 backdrop-blur-sm">
          <div className="card w-full max-w-sm animate-rise-in text-center">
            <p className="pb-1 text-lg font-bold text-slate-100">לסיים את המשחק?</p>
            <p className="pb-5 text-sm leading-relaxed text-slate-400">
              הסבב הנוכחי יימחק ותחזרו למסך הפתיחה. השחקנים וההגדרות יישמרו.
            </p>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={game.reset} className="btn-danger w-full">
                כן, סיימו וחזרו הביתה
              </button>
              <button
                type="button"
                onClick={() => setAsking(false)}
                className="btn-ghost w-full"
              >
                לא, ממשיכים לשחק
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
