import type { PlayerId } from '../../game/types';
import type { ViewPlayer } from '../view';

/**
 * The roster strip. Nothing here may depend on a role — every chip is styled
 * from `alive` and `connected` only, both of which are public facts.
 */
export function PlayerChips({
  players,
  highlight,
  done,
}: {
  players: ViewPlayer[];
  /** Whose turn it is, if anyone's. */
  highlight?: PlayerId | null;
  /** Players who have already supplied whatever the phase is waiting for. */
  done?: PlayerId[];
}) {
  return (
    <ol className="flex w-full flex-wrap justify-center gap-1.5">
      {players.map((player) => {
        const current = highlight === player.id;
        const finished = done?.includes(player.id) ?? false;
        return (
          <li
            key={player.id}
            className={`niqqud flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
              current
                ? 'border-glow bg-glow/20 font-bold text-glow-soft'
                : !player.alive
                  ? 'border-ink-700 bg-ink-850/50 text-slate-600 line-through decoration-slate-600'
                  : finished
                    ? 'border-safe/40 bg-safe/[0.08] text-slate-300'
                    : 'border-ink-700 text-slate-400'
            }`}
          >
            {!player.connected && (
              <span
                aria-label="מנותק"
                title="מנותק"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold"
              />
            )}
            {player.name}
          </li>
        );
      })}
    </ol>
  );
}
