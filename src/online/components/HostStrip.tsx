import { useEffect, useState } from 'react';
import type { HostCommand } from '../protocol';
import type { PlayerView } from '../view';

/**
 * The host's way out when a phone dies mid-phase.
 *
 * Held back for ten seconds on purpose: an override that is on screen the
 * instant a phase opens gets tapped out of impatience, and a room that skips
 * its own reveal is worse than one that waits.
 */
const GRACE_MS = 10_000;

export function HostStrip({
  view,
  stuck,
  onCommand,
  onClose,
}: {
  view: PlayerView;
  stuck: boolean;
  onCommand: (cmd: HostCommand) => void;
  onClose: () => void;
}) {
  const [ripe, setRipe] = useState(false);
  const [open, setOpen] = useState(false);

  // A fresh clock for every phase, so "waited long enough" means waited long
  // enough on *this* screen.
  useEffect(() => {
    setRipe(false);
    setOpen(false);
    const id = window.setTimeout(() => setRipe(true), GRACE_MS);
    return () => window.clearTimeout(id);
  }, [view.phase, view.roundNumber, view.key]);

  const options = commandsFor(view);
  const show = ripe && options.length > 0;

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-3"
        style={{ bottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className="pointer-events-auto flex items-center gap-2">
          {show && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold backdrop-blur transition ${
                stuck
                  ? 'border-gold/60 bg-gold/15 text-gold'
                  : 'border-ink-700 bg-ink-900/80 text-slate-400'
              }`}
            >
              {stuck ? 'מישהו מנותק — אפשר להמשיך' : 'שליטת מארח'}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-ink-950/80 p-3 backdrop-blur-sm">
          <div className="card w-full animate-rise-in">
            <p className="pb-1 text-base font-bold text-slate-100">שליטת מארח</p>
            <p className="pb-4 text-xs leading-relaxed text-slate-500">
              להשתמש רק כשמישהו מנותק או שהמשחק תקוע
            </p>
            <div className="flex flex-col gap-2">
              {options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => {
                    onCommand(option.cmd);
                    setOpen(false);
                  }}
                  className="btn-ghost w-full"
                >
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                onClick={onClose}
                className="btn-danger mt-2 w-full"
              >
                סגירת החדר
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-[44px] text-sm text-slate-500 underline-offset-4 hover:underline"
              >
                חזרה למשחק
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type Option = { label: string; cmd: HostCommand };

function commandsFor(view: PlayerView): Option[] {
  switch (view.phase) {
    case 'REVEAL':
      return [{ label: 'להמשיך בלי מי שלא אישר', cmd: { t: 'FORCE_REVEAL' } }];
    case 'CLUES':
      return [
        { label: 'לדלג על התור הנוכחי', cmd: { t: 'SKIP_TURN' } },
        { label: 'לדלג לדיון', cmd: { t: 'FORCE_ADVANCE' } },
      ];
    case 'DISCUSSION':
      return [
        { label: 'להצבעה עכשיו', cmd: { t: 'FORCE_CHOICE', option: 'VOTE' } },
        {
          label: 'לסבב רמזים נוסף',
          cmd: { t: 'FORCE_CHOICE', option: 'ANOTHER_ROUND' },
        },
      ];
    case 'VOTING':
      return [
        { label: 'לסגור את ההצבעה בלי מי שחסר', cmd: { t: 'FORCE_ADVANCE' } },
      ];
    case 'VOTE_RESULT':
    case 'GAME_OVER':
      return [{ label: 'להמשיך בלי לחכות', cmd: { t: 'FORCE_ADVANCE' } }];
    default:
      return [];
  }
}
