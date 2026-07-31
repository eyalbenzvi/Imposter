import { useEffect, useRef, useState } from 'react';
import { playerById } from '../../game/rules';
import { PassDevice } from '../components/PassDevice';
import { Screen, ScreenBody, ScreenFooter, ScreenHeader } from '../components/Screen';
import { TimerBar } from '../components/TimerBar';
import { useTimer } from '../useTimer';
import type { Game } from '../useGame';
import { RevealAudit } from '../components/RevealAudit';

export function CluesScreen({ game }: { game: Game }) {
  return game.state.settings.clueMode === 'SPEAK' ? (
    <SpeakingRound game={game} />
  ) : (
    <TypingRound game={game} />
  );
}

/** The turn strip: who already went, who is up, who is next. */
function TurnOrder({ game }: { game: Game }) {
  const { state } = game;
  return (
    <ol className="flex w-full flex-wrap justify-center gap-1.5">
      {state.turnOrder.map((id, index) => {
        const done = index < state.clueTurnIndex;
        const current = index === state.clueTurnIndex;
        return (
          <li
            key={id}
            className={`niqqud rounded-full border px-3 py-1 text-sm transition ${
              current
                ? 'border-glow bg-glow/20 font-bold text-glow-soft'
                : done
                  ? 'border-ink-700 bg-ink-850/50 text-slate-500 line-through decoration-slate-600'
                  : 'border-ink-700 text-slate-400'
            }`}
          >
            {playerById(state, id).name}
          </li>
        );
      })}
    </ol>
  );
}

function SpeakingRound({ game }: { game: Game }) {
  const { state, dispatch } = game;
  const currentId = state.turnOrder[state.clueTurnIndex];
  const timer = useTimer(state.settings.clueTimerSeconds, true);

  // A new turn gets a fresh clock.
  useEffect(() => {
    timer.reset();
    if (state.settings.clueTimerSeconds > 0) timer.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  if (!currentId) return null;
  const player = playerById(state, currentId);
  const remaining = state.turnOrder.length - state.clueTurnIndex;

  return (
    <Screen>
      <ScreenHeader
        eyebrow={`סבב ${state.roundNumber}`}
        title="סבב רמזים"
      />

      <ScreenBody className="justify-between">
        <div className="flex w-full shrink-0 flex-col gap-3">
          {state.roundNumber === 1 && <RevealAudit state={state} />}
          <TurnOrder game={game} />
        </div>

        <div className="flex min-h-0 flex-1 animate-slide-from-end flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm tracking-[0.03em] text-glow/70">התור של</p>
          <p
            className="niqqud font-display font-black text-slate-50"
            style={{ fontSize: 'clamp(2.6rem, 14vw, 4.5rem)' }}
          >
            {player.name}
          </p>
          <p className="max-w-[26ch] pt-1 text-base leading-relaxed text-slate-400">
            אמרו <strong className="text-slate-200">מילה אחת</strong> שקשורה למילה
            שקיבלתם — לא מפורשת מדי, לא עמומה מדי
          </p>
        </div>

        {timer.remaining !== null && (
          <div className="w-full shrink-0 max-w-sm">
            <TimerBar timer={timer} total={state.settings.clueTimerSeconds} />
          </div>
        )}
      </ScreenBody>

      <ScreenFooter>
        <button
          type="button"
          onClick={() => dispatch({ type: 'NEXT_CLUE_TURN' })}
          className="btn-primary w-full text-xl"
        >
          {remaining === 1 ? 'לדיון' : 'הבא בתור'}
        </button>
        {remaining > 1 && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'FINISH_CLUES' })}
            className="min-h-[44px] text-sm text-slate-500 underline-offset-4 hover:underline"
          >
            דלגו לדיון
          </button>
        )}
      </ScreenFooter>
    </Screen>
  );
}

function TypingRound({ game }: { game: Game }) {
  const { state, dispatch } = game;
  const currentId = state.turnOrder[state.clueTurnIndex];
  const [handed, setHanded] = useState(false);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setHanded(false);
    setText('');
  }, [currentId]);

  useEffect(() => {
    if (handed) input.current?.focus();
  }, [handed]);

  if (!currentId) return null;
  const player = playerById(state, currentId);

  const submit = () => {
    if (text.trim().length === 0) return;
    dispatch({ type: 'SUBMIT_CLUE', playerId: currentId, text });
  };

  if (!handed) {
    return (
      <Screen>
        <ScreenHeader
          eyebrow={`סבב ${state.roundNumber}`}
          title="סבב רמזים"
        />
        <PassDevice
          key={currentId}
          name={player.name}
          hint="הקלידו רמז של מילה אחת. אף אחד לא יראה אותו עד סוף הסבב"
          cta="זה אני, בואו נתחיל"
          progress={`${state.clueTurnIndex + 1} / ${state.turnOrder.length}`}
          onContinue={() => setHanded(true)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        eyebrow={`${state.clueTurnIndex + 1} / ${state.turnOrder.length}`}
        title={player.name}
      />

      <ScreenBody>
        <p className="max-w-[26ch] text-center text-base leading-relaxed text-slate-400">
          מילה אחת שקשורה למילה שקיבלתם. אסור המילה עצמה, נטייה שלה או תרגום שלה
        </p>
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="הרמז שלי"
          maxLength={22}
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="done"
          dir="rtl"
          className="niqqud w-full rounded-2xl border-2 border-ink-600 bg-ink-850 px-4 py-4 text-center font-display text-3xl text-slate-50 outline-none transition placeholder:text-slate-600 focus:border-glow focus:bg-ink-800"
        />
      </ScreenBody>

      <ScreenFooter>
        <button
          type="button"
          onClick={submit}
          disabled={text.trim().length === 0}
          className="btn-primary w-full text-xl"
        >
          {state.clueTurnIndex + 1 === state.turnOrder.length
            ? 'שלחו וסיימו את הסבב'
            : 'שלחו והעבירו הלאה'}
        </button>
      </ScreenFooter>
    </Screen>
  );
}
