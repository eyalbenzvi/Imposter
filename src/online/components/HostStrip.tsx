import { useEffect, useState } from 'react';
import type { HostCommand } from '../protocol';
import type { PlayerView } from '../view';

/**
 * The host's controls: overrides when a phone dies mid-phase, the way back to
 * the lobby between games, and the way to close the room.
 *
 * Three rules earn their keep here:
 *
 *  1. **It lives in the header corner, not over the footer.** It used to be
 *     fixed to the bottom of the screen, directly on top of the primary buttons
 *     — so on every screen with a footer it covered the thing the host was
 *     trying to tap. `ScreenHeader` already reserves this corner (`pe-14`); it
 *     is where the single-device game puts its home button and where a guest
 *     gets theirs. Overlap becomes impossible rather than something z-index has
 *     to keep negotiating.
 *  2. **The button is always there.** It used to render only when the phase had
 *     overrides to offer — and "close the room" lives inside the sheet it opens,
 *     so in the one phase with no overrides (the imposter's guess, where the
 *     only player who may act has just been voted out) the host had no control
 *     of any kind.
 *  3. **Panic buttons are held back ten seconds; deliberate ones are not.** An
 *     escape hatch that is there the instant a phase opens gets tapped out of
 *     impatience. "Change the settings" is not an escape hatch, so it appears
 *     immediately.
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

  // A fresh clock for every screen, so "waited long enough" means waited long
  // enough on *this* one. `view.key` is the epoch, which in SPEAK mode moves on
  // every turn — that is intentional here: each player gets their own grace
  // before the host can skip them.
  useEffect(() => {
    setRipe(false);
    const id = window.setTimeout(() => setRipe(true), GRACE_MS);
    return () => window.clearTimeout(id);
  }, [view.phase, view.roundNumber, view.key]);

  // Closing the sheet is a *phase* change, not an epoch change. Tied to the
  // epoch it shut under the host's finger on every clue turn, mid-read.
  useEffect(() => {
    setOpen(false);
    setConfirming(false);
  }, [view.phase]);

  // Overrides wait; deliberate actions do not.
  const options = [...(ripe ? commandsFor(view) : []), ...alwaysFor(view)];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="שליטת מארח"
        className={`fixed z-40 grid h-11 w-11 place-items-center rounded-xl border
          text-lg backdrop-blur transition active:scale-95 ${
            stuck
              ? 'border-gold/70 bg-gold/20 text-gold'
              : 'border-ink-700 bg-ink-900/80 text-slate-400 hover:border-glow/60'
          }`}
        style={{
          // The same logical corner the home button uses in the single-device
          // game, which every `ScreenHeader` already keeps clear.
          insetInlineEnd: 'max(0.75rem, env(safe-area-inset-right))',
          top: 'max(0.75rem, env(safe-area-inset-top))',
        }}
      >
        ⚙
        {stuck && (
          <span
            aria-hidden
            className="absolute -top-0.5 -end-0.5 h-2.5 w-2.5 rounded-full bg-gold"
          />
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-end bg-ink-950/80 p-3 backdrop-blur-sm">
          <div className="card w-full animate-rise-in">
            <p className="pb-1 text-base font-bold text-slate-100">שליטת מארח</p>
            <p className="pb-4 text-xs leading-relaxed text-slate-500">
              {stuck
                ? 'מישהו מנותק — אפשר להמשיך בלעדיו'
                : options.length > 0
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

/**
 * Deliberate actions, available the moment the screen opens.
 *
 * Separate from `commandsFor` because the ten-second wait is right for a panic
 * button and wrong for "we want to change the settings before the next round" —
 * a host tapping that has decided, not panicked.
 */
function alwaysFor(view: PlayerView): Option[] {
  if (view.phase !== 'GAME_OVER') return [];
  return [
    {
      label: 'לשנות הגדרות / לצרף שחקנים',
      cmd: { t: 'REOPEN' },
    },
  ];
}

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
