import { useState } from 'react';
import type { Game } from '../useGame';

/**
 * Bail out to setup. Confirms first, because it throws away the round —
 * deliberately absent from the reveal flow, where going back would leak roles.
 */
export function ExitButton({ game }: { game: Game }) {
  const [asking, setAsking] = useState(false);

  if (asking) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/85 p-6 backdrop-blur-sm">
        <div className="card w-full max-w-sm animate-rise-in text-center">
          <p className="pb-1 text-lg font-bold text-slate-100">לצאת מהמשחק?</p>
          <p className="pb-5 text-sm text-slate-400">
            הסבב הנוכחי יימחק. השחקנים וההגדרות יישמרו.
          </p>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={game.reset} className="btn-danger w-full">
              כן, חזרו למסך הפתיחה
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="btn-ghost w-full"
            >
              לא, ממשיכים
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setAsking(true)}
      aria-label="יציאה מהמשחק"
      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-ink-700 text-lg text-slate-500 transition active:scale-95 hover:border-danger/50 hover:text-danger"
    >
      ✕
    </button>
  );
}
