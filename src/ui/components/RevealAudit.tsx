import { useState } from 'react';
import { revealAudit } from '../../game/rules';
import type { GameState } from '../../game/types';

/**
 * Shown to the whole group right after the handout: every player uncovered
 * their word exactly once. This is the assurance side of the reveal — the
 * counter is kept in game state, so it is the same number the player saw on
 * their own screen, not a claim the UI makes up afterwards.
 */
export function RevealAudit({ state }: { state: GameState }) {
  const [open, setOpen] = useState(true);
  const audit = revealAudit(state);

  if (!open) return null;

  return (
    <div
      className={`w-full shrink-0 animate-rise-in rounded-2xl border px-3 py-1.5 ${
        audit.everyoneSawOnce
          ? 'border-safe/40 bg-safe/[0.07]'
          : 'border-gold/40 bg-gold/[0.07]'
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <p
          className={`text-xs font-bold leading-snug ${
            audit.everyoneSawOnce ? 'text-safe' : 'text-gold'
          }`}
        >
          {audit.everyoneSawOnce
            ? 'כל השחקנים ראו את המילה שלהם פעם אחת בלבד'
            : `נרשמו ${audit.extraViews} חשיפות עודפות`}
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="סגור"
          className="-me-2 grid h-12 w-12 shrink-0 place-items-center rounded-lg text-slate-500 hover:text-slate-300"
        >
          ✕
        </button>
      </div>

      <ul className="flex flex-wrap gap-1 pt-1">
        {audit.rows.map((row) => (
          <li
            key={row.playerId}
            className="niqqud flex items-center gap-1 rounded-full border border-ink-700 bg-ink-900/60 px-2 py-0 text-[11px] text-slate-300"
          >
            {row.name}
            <span
              className={`num font-bold ${
                row.views === 1 ? 'text-safe' : 'text-gold'
              }`}
            >
              {row.views}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
