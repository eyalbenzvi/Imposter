import { playerById } from '../../game/rules';
import { ExitButton } from '../components/ExitButton';
import { Screen, ScreenBody, ScreenFooter, ScreenHeader } from '../components/Screen';
import type { Game } from '../useGame';

export function VoteResultScreen({ game }: { game: Game }) {
  const { state, dispatchSeeded } = game;
  const result = state.lastVote;
  if (!result) return null;

  const ejected = result.ejectedId ? playerById(state, result.ejectedId) : null;
  const wasImposter = result.ejectedWasImposter === true;
  const votesFor = (id: string) =>
    result.votes.filter((v) => v.target === id).map((v) => playerById(state, v.voter).name);

  const headline =
    result.outcome === 'EJECTED'
      ? `${ejected!.name} הודח`
      : result.outcome === 'TIE_RUNOFF'
        ? 'תיקו'
        : 'תיקו שני — אף אחד לא הודח';

  const cta =
    result.outcome === 'TIE_RUNOFF'
      ? 'להצבעה חוזרת'
      : result.outcome === 'TIE_NO_EJECTION'
        ? 'לסבב רמזים נוסף'
        : 'המשיכו';

  return (
    <Screen>
      <ScreenHeader
        eyebrow={`סבב ${state.roundNumber} · תוצאות ההצבעה`}
        action={<ExitButton game={game} />}
      />

      <ScreenBody className="justify-start gap-4">
        {/* The verdict */}
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
              מצביעים שוב, הפעם רק בין{' '}
              {result.tiedIds.map((id) => playerById(state, id).name).join(' ו')}
            </p>
          )}
          {result.outcome === 'TIE_NO_EJECTION' && (
            <p className="pt-3 text-base text-slate-400">
              שני תיקו רצופים — כולם נשארים, ממשיכים לסבב רמזים נוסף
            </p>
          )}
        </div>

        {/* Full breakdown — who voted for whom */}
        <div className="min-h-0 w-full flex-1 overflow-y-auto">
          <p className="pb-2 text-xs font-semibold tracking-[0.04em] text-slate-500">
            הספירה המלאה
          </p>
          <ul className="flex flex-col gap-1.5">
            {result.tally.map((row) => {
              const voters = votesFor(row.playerId);
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
                      {playerById(state, row.playerId).name}
                    </span>
                    <span className="niqqud block truncate text-xs text-slate-500">
                      {voters.length > 0 ? voters.join(' · ') : 'ללא הצבעות'}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </ScreenBody>

      <ScreenFooter>
        <button
          type="button"
          onClick={() => dispatchSeeded('CONTINUE')}
          className="btn-primary w-full text-xl"
        >
          {cta}
        </button>
      </ScreenFooter>
    </Screen>
  );
}
