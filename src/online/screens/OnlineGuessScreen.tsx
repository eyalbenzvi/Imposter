import { useState } from 'react';
import {
  Screen,
  ScreenBody,
  ScreenFooter,
  ScreenHeader,
} from '../../ui/components/Screen';
import type { GameScreenProps } from './props';

/**
 * The caught imposter's last shot.
 *
 * On one device everybody stares at the same four words, which rather gives the
 * game away. Here the options go to the guesser's phone alone — the four ids
 * include the secret word, so handing them to a bystander would put them one
 * guess in four from it. Everyone else gets a waiting screen with a name on it.
 */
export function OnlineGuessScreen({ view, send }: GameScreenProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const guesser =
    view.players.find((p) => p.id === view.guessingPlayerId)?.name ?? '';
  const hidden = view.settings.mode === 'HIDDEN';

  if (!view.guessOptions) {
    return (
      <Screen>
        <ScreenHeader eyebrow="הזדמנות אחרונה" title="ניחוש המתחזה" />
        <ScreenBody>
          <p
            className="niqqud font-display font-black text-slate-50"
            style={{ fontSize: 'clamp(2rem, 11vw, 3.2rem)' }}
          >
            {guesser}
          </p>
          <p className="max-w-[26ch] text-center text-base leading-relaxed text-slate-400">
            מנסה לנחש את המילה הסודית מתוך ארבע. אם יצליח/תצליח — המתחזה מנצח
          </p>
        </ScreenBody>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader eyebrow="הזדמנות אחרונה" title="הניחוש שלך" />

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
          {view.guessOptions.map((option) => {
            const active = picked === option.id;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => setPicked(option.id)}
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
                    {option.word}
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
          onClick={() => picked && send({ t: 'GUESS', wordId: picked })}
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
