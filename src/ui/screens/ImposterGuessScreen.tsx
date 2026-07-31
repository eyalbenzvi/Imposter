import { useState } from 'react';
import { playerById } from '../../game/rules';
import { getWordEntry } from '../../game/words';
import { Screen, ScreenBody, ScreenFooter, ScreenHeader } from '../components/Screen';
import type { Game } from '../useGame';

/**
 * The caught imposter's one shot at the secret word: 4 options, all pointed,
 * all from the same category.
 */
export function ImposterGuessScreen({ game }: { game: Game }) {
  const { state, dispatch } = game;
  const [picked, setPicked] = useState<string | null>(null);
  if (!state.guessOptions || !state.guessingImposterId) return null;

  const imposter = playerById(state, state.guessingImposterId);
  const hidden = state.settings.mode === 'HIDDEN';

  return (
    <Screen>
      <ScreenHeader eyebrow="הזדמנות אחרונה" title={`${imposter.name} — הניחוש שלך`} />

      <ScreenBody className="justify-start gap-4">
        <div className="w-full shrink-0 animate-rise-in rounded-2xl border border-danger/40 bg-danger/[0.07] px-4 py-3 text-center">
          {hidden ? (
            <p className="text-base leading-relaxed text-slate-200">
              המילה שקיבלת הייתה <strong className="text-danger">תחליף</strong>.
              <br />
              המילה האמיתית הייתה אחרת.
            </p>
          ) : (
            <p className="text-base leading-relaxed text-slate-200">
              נתפסת. אבל אם תנחש את המילה הסודית —{' '}
              <strong className="text-danger">תנצח בכל זאת</strong>.
            </p>
          )}
        </div>

        <p className="shrink-0 text-center text-sm text-slate-400">
          איזו מהמילים האלה הייתה המילה הסודית?
        </p>

        <ul className="grid w-full min-h-0 flex-1 auto-rows-min content-center grid-cols-1 gap-2 overflow-y-auto">
          {state.guessOptions.map((id) => {
            const entry = getWordEntry(id);
            const active = picked === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setPicked(id)}
                  aria-pressed={active}
                  className={`flex min-h-[72px] w-full items-center justify-center rounded-2xl border-2 px-4 py-3 transition active:scale-[0.98] ${
                    active
                      ? 'border-glow bg-glow/15'
                      : 'border-ink-600 bg-ink-850/70 hover:border-glow/50'
                  }`}
                >
                  <span
                    dir="rtl"
                    lang="he"
                    className={`niqqud font-display text-3xl font-bold ${
                      active ? 'text-glow-soft' : 'text-slate-100'
                    }`}
                  >
                    {entry.word}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </ScreenBody>

      <ScreenFooter>
        <button
          type="button"
          disabled={picked === null}
          onClick={() => picked && dispatch({ type: 'SUBMIT_GUESS', wordId: picked })}
          className="btn-primary w-full text-xl"
        >
          {picked ? 'זו המילה שלי' : 'בחרו מילה'}
        </button>
        <p className="text-center text-xs text-slate-500">
          הזדמנות אחת. אין חזרה אחורה
        </p>
      </ScreenFooter>
    </Screen>
  );
}
