import { getSecretEntry, playerById } from '../../game/rules';
import { Screen, ScreenBody, ScreenFooter, ScreenHeader } from '../components/Screen';
import { WordChip } from '../components/WordHero';
import type { Game } from '../useGame';

export function GameOverScreen({ game }: { game: Game }) {
  const { state, dispatchSeeded, reset } = game;
  const entry = getSecretEntry(state);
  const impostersWon = state.winner === 'IMPOSTERS';
  const imposterNames = state.imposterIds.map((id) => playerById(state, id).name);

  const subtitle = (() => {
    if (state.guessResult === 'CORRECT') return 'נתפס — אבל ניחש את המילה הסודית';
    if (state.guessResult === 'WRONG') return 'נתפס, וניחש לא נכון';
    if (impostersWon) return 'המתחזה שרד עד הסוף';
    return 'כל המתחזים הודחו';
  })();

  return (
    <Screen>
      <ScreenHeader
        eyebrow={
          state.roundNumber === 1
            ? 'הסתיים בסבב הראשון'
            : `הסתיים לאחר ${state.roundNumber} סבבים`
        }
      />

      <ScreenBody className="justify-start gap-4">
        <div className="w-full shrink-0 animate-rise-in text-center">
          <p
            className={`niqqud font-display font-black ${
              impostersWon ? 'text-danger' : 'text-safe'
            }`}
            style={{ fontSize: 'clamp(2.2rem, 12vw, 3.6rem)' }}
          >
            {impostersWon
              ? state.imposterIds.length > 1
                ? 'הַמִּתְחַזִּים נִצְּחוּ'
                : 'הַמִּתְחַזֶּה נִצֵּחַ'
              : 'הָאֶזְרָחִים נִצְּחוּ'}
          </p>
          <p className="pt-1 text-base text-slate-400">{subtitle}</p>
        </div>

        <div className="flex min-h-0 w-full flex-1 flex-col justify-center overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            {entry && <WordChip label="המילה הסודית" word={entry.word} tone="good" />}
            {state.hintWord && (
              <WordChip
                label={state.hintKind === 'CLUE' ? 'הרמז למתחזה' : 'מילת הרמז'}
                word={state.hintWord}
                tone="bad"
              />
            )}
          </div>

          <div className="mt-2 rounded-2xl border border-ink-700 bg-ink-850/60 px-4 py-3 text-center">
            <p className="text-xs font-semibold tracking-[0.04em] text-slate-500">
              {imposterNames.length > 1 ? 'המתחזים' : 'המתחזה'}
            </p>
            <p className="niqqud font-display text-2xl font-bold text-danger">
              {imposterNames.join(' · ')}
            </p>
          </div>

          {entry && (
            <p className="pt-3 text-center text-xs text-slate-600">
              קטגוריה: {entry.category}
            </p>
          )}
        </div>
      </ScreenBody>

      <ScreenFooter>
        <button
          type="button"
          onClick={() => dispatchSeeded('NEW_ROUND')}
          className="btn-primary w-full text-xl"
        >
          סבב נוסף
        </button>
        <button type="button" onClick={reset} className="btn-ghost w-full">
          שינוי שחקנים והגדרות
        </button>
      </ScreenFooter>
    </Screen>
  );
}
