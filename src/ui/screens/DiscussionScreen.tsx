import { playerById } from '../../game/rules';
import { Screen, ScreenBody, ScreenFooter, ScreenHeader } from '../components/Screen';
import { TimerBar } from '../components/TimerBar';
import { useTimer } from '../useTimer';
import type { Game } from '../useGame';

export function DiscussionScreen({ game }: { game: Game }) {
  const { state, dispatchSeeded } = game;
  const timer = useTimer(state.settings.discussionSeconds, true);
  const clueBoard = state.settings.clueMode === 'TYPE';

  return (
    <Screen>
      <ScreenHeader
        eyebrow={`סבב ${state.roundNumber}`}
        title="דיון"
      />

      <ScreenBody className="justify-start">
        {clueBoard ? (
          <ul className="grid w-full min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2 overflow-y-auto pt-1">
            {state.turnOrder.map((id) => (
              <li
                key={id}
                className="flex animate-rise-in flex-col justify-center rounded-2xl border border-ink-700 bg-ink-850/70 px-3 py-2 text-center"
              >
                <p className="niqqud truncate text-xs text-slate-500">
                  {playerById(state, id).name}
                </p>
                <p className="niqqud font-display text-xl font-bold text-slate-100">
                  {state.clues[id] ?? '—'}
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
                {state.discussionOrder.map((id, i) => (
                  <li
                    key={id}
                    className="niqqud flex items-center gap-1.5 rounded-full border border-ink-700 px-3 py-1 text-sm text-slate-300"
                  >
                    <span className="num text-xs text-glow/80">{i + 1}</span>
                    {playerById(state, id).name}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {timer.remaining !== null && (
          <div className="w-full shrink-0 pt-2">
            <TimerBar timer={timer} total={state.settings.discussionSeconds} />
          </div>
        )}
      </ScreenBody>

      <ScreenFooter>
        <button
          type="button"
          onClick={() => dispatchSeeded('START_VOTING')}
          className="btn-primary w-full text-xl"
        >
          להצבעה
        </button>
        {/* Not ready to accuse anyone yet — hear everyone again first. Same
            secret word, fresh turn order. */}
        <button
          type="button"
          onClick={() => dispatchSeeded('ANOTHER_CLUE_ROUND')}
          className="btn-ghost w-full"
        >
          סבב רמזים נוסף
        </button>
      </ScreenFooter>
    </Screen>
  );
}
