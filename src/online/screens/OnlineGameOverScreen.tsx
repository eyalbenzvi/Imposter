import {
  Screen,
  ScreenBody,
  ScreenFooter,
  ScreenHeader,
} from '../../ui/components/Screen';
import { WordChip } from '../../ui/components/WordHero';
import { WaitingPanel } from '../components/WaitingPanel';
import type { GameScreenProps } from './props';

export function OnlineGameOverScreen({ view, send }: GameScreenProps) {
  const ending = view.ending;
  if (!ending) return null;

  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  const impostersWon = ending.winner === 'IMPOSTERS';
  const imposterNames = ending.imposterIds.map(nameOf);

  const subtitle = (() => {
    if (ending.guessResult === 'CORRECT') return 'נתפס — אבל ניחש את המילה הסודית';
    if (ending.guessResult === 'WRONG') return 'נתפס, וניחש לא נכון';
    if (impostersWon) return 'המתחזה שרד עד הסוף';
    return 'כל המתחזים הודחו';
  })();

  return (
    <Screen>
      <ScreenHeader
        eyebrow={
          view.roundNumber === 1
            ? 'הסתיים בסבב הראשון'
            : `הסתיים לאחר ${view.roundNumber} סבבים`
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
              ? ending.imposterIds.length > 1
                ? 'הַמִּתְחַזִּים נִצְּחוּ'
                : 'הַמִּתְחַזֶּה נִצֵּחַ'
              : 'הָאֶזְרָחִים נִצְּחוּ'}
          </p>
          <p className="pt-1 text-base text-slate-400">{subtitle}</p>
        </div>

        <div className="flex min-h-0 w-full flex-1 flex-col justify-center overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            <WordChip label="המילה הסודית" word={ending.secretWord} tone="good" />
            {ending.hintWord && (
              <WordChip
                label={ending.hintKind === 'CLUE' ? 'הרמז למתחזה' : 'מילת הרמז'}
                word={ending.hintWord}
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

          <p className="pt-3 text-center text-xs text-slate-600">
            קטגוריה: {ending.category}
          </p>
        </div>
      </ScreenBody>

      <ScreenFooter>
        {view.waiting && <WaitingPanel waiting={view.waiting} label="מוכנים לסבב נוסף" />}
        <button
          type="button"
          disabled={view.waiting?.youDone}
          onClick={() => send({ t: 'READY' })}
          className="btn-primary w-full text-xl disabled:opacity-40"
        >
          {view.waiting?.youDone ? 'מחכים לשאר' : 'סבב נוסף'}
        </button>
      </ScreenFooter>
    </Screen>
  );
}
