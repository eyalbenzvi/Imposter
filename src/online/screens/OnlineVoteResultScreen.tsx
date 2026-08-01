import {
  Screen,
  ScreenBody,
  ScreenFooter,
  ScreenHeader,
} from '../../ui/components/Screen';
import { WaitingPanel } from '../components/WaitingPanel';
import type { GameScreenProps } from './props';

/**
 * The tally, on everybody's screen at the same moment.
 *
 * Ejected players get the ready button too. The round is over; they are still
 * in the room holding a phone, and "shall we carry on" is not a decision the
 * survivors make on their own.
 */
export function OnlineVoteResultScreen({ view, send }: GameScreenProps) {
  const result = view.lastVote;
  if (!result) return null;

  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  const ejected = result.ejectedId ? nameOf(result.ejectedId) : null;
  const wasImposter = result.ejectedWasImposter === true;
  const votersFor = (id: string) =>
    result.votes.filter((v) => v.target === id).map((v) => nameOf(v.voter));
  const scored = result.tally.filter((row) => row.count > 0);
  const unscored = result.tally.filter((row) => row.count === 0);

  const headline =
    result.outcome === 'EJECTED'
      ? `${ejected} הודח`
      : result.outcome === 'TIE_RUNOFF'
        ? 'תיקו'
        : 'תיקו שני — אף אחד לא הודח';

  return (
    <Screen>
      <ScreenHeader eyebrow={`סבב ${view.roundNumber} · תוצאות ההצבעה`} />

      <ScreenBody className="justify-start gap-4">
        <div className="w-full shrink-0 animate-rise-in text-center">
          <p
            className="niqqud font-display font-black text-slate-50"
            style={{ fontSize: 'clamp(1.8rem, 9vw, 2.6rem)' }}
          >
            {headline}
          </p>

          {ejected && (
            <div
              className={`mt-3 rounded-2xl border px-4 py-3 ${
                wasImposter
                  ? 'border-danger/50 bg-danger/10'
                  : 'border-safe/40 bg-safe/10'
              }`}
            >
              <p className="text-sm text-slate-400">והתפקיד היה</p>
              <p
                className={`niqqud font-display text-3xl font-black ${
                  wasImposter ? 'text-danger' : 'text-safe'
                }`}
              >
                {wasImposter ? 'מִתְחַזֶּה' : 'אֶזְרָח'}
              </p>
            </div>
          )}

          {result.outcome === 'TIE_RUNOFF' && (
            <p className="pt-3 text-base text-slate-400">
              מצביעים שוב, הפעם רק בין {result.tiedIds.map(nameOf).join(' ו')}
            </p>
          )}
          {result.outcome === 'TIE_NO_EJECTION' && (
            <p className="pt-3 text-base text-slate-400">
              שני תיקו רצופים — כולם נשארים, ממשיכים לסבב רמזים נוסף
            </p>
          )}
        </div>

        <div className="min-h-0 w-full flex-1 overflow-y-auto">
          <p className="pb-2 text-xs font-semibold tracking-[0.04em] text-slate-500">
            הספירה המלאה
          </p>
          <ul className="flex flex-col gap-1.5">
            {scored.map((row) => {
              const isEjected = row.playerId === result.ejectedId;
              const isTied = result.tiedIds.includes(row.playerId);
              return (
                <li
                  key={row.playerId}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                    isEjected
                      ? 'border-danger/50 bg-danger/10'
                      : isTied
                        ? 'border-gold/40 bg-gold/[0.07]'
                        : 'border-ink-700 bg-ink-850/50'
                  }`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-800 font-display text-lg font-bold tabular-nums text-slate-200">
                    {row.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="niqqud block truncate text-base font-bold text-slate-100">
                      {nameOf(row.playerId)}
                    </span>
                    <span className="niqqud block text-xs leading-snug text-slate-400">
                      {votersFor(row.playerId).join(' · ')}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>

          {unscored.length > 0 && (
            <p className="niqqud pt-2 text-xs leading-relaxed text-slate-600">
              ללא הצבעות: {unscored.map((row) => nameOf(row.playerId)).join(' · ')}
            </p>
          )}
        </div>
      </ScreenBody>

      <ScreenFooter>
        {view.waiting && <WaitingPanel waiting={view.waiting} label="מוכנים להמשיך" />}
        <button
          type="button"
          disabled={view.waiting?.youDone}
          onClick={() => send({ t: 'READY' })}
          className="btn-primary w-full text-xl disabled:opacity-40"
        >
          {view.waiting?.youDone ? 'מחכים לשאר' : 'מוכן להמשיך'}
        </button>
      </ScreenFooter>
    </Screen>
  );
}
