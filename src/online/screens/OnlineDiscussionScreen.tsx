import {
  Screen,
  ScreenBody,
  ScreenFooter,
  ScreenHeader,
} from '../../ui/components/Screen';
import { DeadlineBar } from '../components/DeadlineBar';
import type { GameScreenProps } from './props';

/**
 * The one screen where the group decides rather than acts, so it is the one
 * place the majority rule is visible: two buttons, a live tally on each, and
 * whichever reaches a majority first wins.
 *
 * An even split cannot be left hanging — with four alive, 2–2 reaches a
 * majority for neither. Once everybody has chosen, the driver breaks the tie
 * toward the vote; the footnote below says so, because a group that can't see
 * the rule will just keep tapping.
 */
export function OnlineDiscussionScreen({ view, send }: GameScreenProps) {
  const board = view.settings.clueMode === 'TYPE';
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  const alive = view.players.filter((p) => p.alive).length;
  const needed = Math.floor(alive / 2) + 1;

  return (
    <Screen>
      <ScreenHeader eyebrow={`סבב ${view.roundNumber}`} title="דיון" />

      <ScreenBody className="justify-start">
        {board ? (
          <ul className="grid w-full min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2 overflow-y-auto pt-1">
            {view.turnOrder.map((id) => (
              <li
                key={id}
                className="flex animate-rise-in flex-col justify-center rounded-2xl border border-ink-700 bg-ink-850/70 px-3 py-2 text-center"
              >
                <p className="niqqud truncate text-xs text-slate-500">{nameOf(id)}</p>
                <p className="niqqud font-display text-xl font-bold text-slate-100">
                  {view.clues?.[id] ?? '—'}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center">
            <p
              className="niqqud font-display font-black text-slate-50"
              style={{ fontSize: 'clamp(1.9rem, 9vw, 2.8rem)' }}
            >
              מי לא מתחבר?
            </p>
            <p className="max-w-[28ch] text-base leading-relaxed text-slate-400">
              דברו על הרמזים שנאמרו. מי היה כללי מדי? מי היה מדויק בצורה חשודה?
            </p>
            <div className="w-full pt-2">
              <p className="pb-1.5 text-xs font-semibold tracking-[0.04em] text-glow/70">
                סדר הדיבור בדיון
              </p>
              <ol className="flex flex-wrap justify-center gap-1.5">
                {view.discussionOrder.map((id, i) => (
                  <li
                    key={id}
                    className="niqqud flex items-center gap-1.5 rounded-full border border-ink-700 px-3 py-1 text-sm text-slate-300"
                  >
                    <span className="num text-xs text-glow/80">{i + 1}</span>
                    {nameOf(id)}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        <div className="w-full shrink-0 pt-2">
          <DeadlineBar view={view} total={view.settings.discussionSeconds} />
        </div>
      </ScreenBody>

      <ScreenFooter>
        {view.you.alive ? (
          <>
            <div className="flex gap-2">
              <Choice
                label="להצבעה"
                count={view.choiceTally.VOTE}
                needed={needed}
                picked={view.yourChoice === 'VOTE'}
                tone="primary"
                onClick={() => send({ t: 'CHOOSE', option: 'VOTE' })}
              />
              <Choice
                label="סבב רמזים נוסף"
                count={view.choiceTally.ANOTHER_ROUND}
                needed={needed}
                picked={view.yourChoice === 'ANOTHER_ROUND'}
                tone="ghost"
                onClick={() => send({ t: 'CHOOSE', option: 'ANOTHER_ROUND' })}
              />
            </div>
            <p className="text-center text-xs text-slate-500">
              {view.yourChoice
                ? `צריך ${needed} מתוך ${alive}. אפשר להחליף בחירה עד שיוכרע`
                : `בוחרים ביחד — הרוב מכריע (${needed} מתוך ${alive})`}
            </p>
          </>
        ) : (
          <p className="text-center text-sm text-slate-500">
            הודחתם — החיים מחליטים איך ממשיכים
          </p>
        )}
      </ScreenFooter>
    </Screen>
  );
}

function Choice({
  label,
  count,
  needed,
  picked,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  needed: number;
  picked: boolean;
  tone: 'primary' | 'ghost';
  onClick: () => void;
}) {
  const base =
    tone === 'primary'
      ? 'border-glow bg-glow/15 text-glow-soft'
      : 'border-ink-600 bg-ink-850/70 text-slate-300';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={picked}
      className={`flex min-h-[64px] flex-1 flex-col items-center justify-center gap-0.5
        rounded-2xl border-2 px-3 py-2 text-center text-base font-bold transition
        active:scale-[0.98] ${base} ${picked ? 'ring-2 ring-glow/70' : 'opacity-90'}`}
    >
      <span>{label}</span>
      <span className="num text-xs font-normal tabular-nums opacity-70">
        {count} / {needed}
      </span>
    </button>
  );
}
