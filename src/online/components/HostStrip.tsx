import { useEffect, useState } from 'react';
import type { HostCommand } from '../protocol';
import type { PlayerView } from '../view';

/**
 * The host's way out when a phone dies mid-phase.
 *
 * Two rules earn their keep here:
 *
 *  1. **The button is always on screen.** It used to render only when the phase
 *     had overrides to offer — and "close the room" lives inside the sheet it
 *     opens, so in the one phase with no overrides (the imposter's guess, where
 *     the only player who may act has just been voted out) the host had no
 *     control of any kind, and a refresh put them straight back on the same
 *     dead screen for the whole six-hour session TTL.
 *  2. **The overrides are held back ten seconds.** An escape hatch that is
 *     there the instant a phase opens gets tapped out of impatience, and a room
 *     that skips its own reveal is worse than one that waits.
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
  const [confirming, setConfirming] = useState(false);

  // A fresh clock for every phase, so "waited long enough" means waited long
  // enough on *this* screen.
  useEffect(() => {
    setRipe(false);
    setOpen(false);
    const id = window.setTimeout(() => setRipe(true), GRACE_MS);
    return () => window.clearTimeout(id);
  }, [view.phase, view.roundNumber, view.key]);

  const options = ripe ? commandsFor(view) : [];

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-3"
        style={{ bottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`pointer-events-auto min-h-[36px] rounded-full border px-3 text-xs
            font-semibold backdrop-blur transition ${
              stuck
                ? 'border-gold/60 bg-gold/15 text-gold'
                : 'border-ink-700 bg-ink-900/80 text-slate-500'
            }`}
        >
          {stuck ? 'מישהו מנותק — אפשר להמשיך' : 'שליטת מארח'}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-end bg-ink-950/80 p-3 backdrop-blur-sm">
          <div className="card w-full animate-rise-in">
            <p className="pb-1 text-base font-bold text-slate-100">שליטת מארח</p>
            <p className="pb-4 text-xs leading-relaxed text-slate-500">
              {options.length > 0
                ? 'להשתמש רק כשמישהו מנותק או שהמשחק תקוע'
                : 'תנו לקבוצה עוד רגע. אם המשחק תקוע, האפשרויות יופיעו כאן'}
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

              {confirming ? (
                <div className="mt-2 rounded-2xl border border-danger/40 bg-danger/[0.07] p-3">
                  <p className="pb-3 text-center text-sm leading-relaxed text-slate-300">
                    החדר ייסגר לכולם והמשחק ייגמר
                  </p>
                  <button type="button" onClick={onClose} className="btn-danger w-full">
                    כן, לסגור את החדר
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="btn-danger mt-2 w-full"
                >
                  סגירת החדר
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setConfirming(false);
                }}
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
        {
          label:
            view.settings.clueMode === 'SPEAK'
              ? 'לדלג על התור הנוכחי'
              : 'לדלג על התור הנוכחי (יירשם —)',
          cmd: { t: 'SKIP_TURN' },
        },
        { label: 'לסיים את הסבב ולעבור לדיון', cmd: { t: 'FORCE_ADVANCE' } },
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
        {
          label: 'לסגור את ההצבעה — מי שלא הצביע יצטרף לרוב',
          cmd: { t: 'FORCE_ADVANCE' },
        },
      ];
    case 'IMPOSTER_GUESS':
      // The one player who may act here is the imposter who was just voted out.
      // If their phone is gone there is no legal input at all, so the host has
      // to be able to end it — as a forfeit, not a free one-in-four guess.
      return [
        { label: 'המנחש לא זמין — לוותר על הניחוש', cmd: { t: 'FORCE_ADVANCE' } },
      ];
    case 'VOTE_RESULT':
    case 'GAME_OVER':
      return [{ label: 'להמשיך בלי לחכות', cmd: { t: 'FORCE_ADVANCE' } }];
    default:
      return [];
  }
}
