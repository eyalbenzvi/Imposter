import { gameOverReason, nextStepAfterVote, playerById } from '../../game/rules';
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
  const scored = result.tally.filter((row) => row.count > 0);
  const unscored = result.tally.filter((row) => row.count === 0);

  const headline =
    result.outcome === 'EJECTED'
      ? `${ejected!.name} הודח`
      : result.outcome === 'TIE_RUNOFF'
        ? 'תיקו'
        : 'תיקו שני — אף אחד לא הודח';

  // Labelled from the same function the reducer routes on, so the button can
  // never promise a round that isn't coming. It used to read "המשיכו" whether
  // play continued or the game had just ended.
  const next = nextStepAfterVote(state);
  const over = next === 'GAME_OVER';
  const reason = gameOverReason(state);
  const cta = {
    RUNOFF: 'להצבעה חוזרת',
    IMPOSTER_GUESS: 'לניחוש האחרון של המתחזה',
    GAME_OVER: 'לתוצאות המשחק',
    NEXT_CLUE_ROUND: 'לסבב רמזים נוסף',
  }[next];

  return (
    <Screen>
      <ScreenHeader eyebrow={`סבב ${state.roundNumber} · תוצאות ההצבעה`} />

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

          {/* Say outright that this is the end, and why — the tally alone left
              people expecting another round. */}
          {over && (
            <p
              className={`niqqud pt-3 font-display text-2xl font-black ${
                reason === 'IMPOSTER_CAUGHT' ? 'text-safe' : 'text-danger'
              }`}
            >
              הַמִּשְׂחָק נִגְמַר
            </p>
          )}
          {over && (
            <p className="pt-1 text-base text-slate-400">
              {reason === 'IMPOSTER_CAUGHT'
                ? state.imposterIds.length > 1
                  ? 'כל המתחזים הודחו'
                  : 'המתחזה נתפס'
                : 'נותרו שני שחקנים בלבד'}
            </p>
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

        {/* Full breakdown — who voted for whom. Players nobody voted for are
            collapsed into one line, so with a big group the rows that actually
            carry information stay above the fold. */}
        <div className="min-h-0 w-full flex-1 overflow-y-auto">
          <p className="pb-2 text-xs font-semibold tracking-[0.04em] text-slate-500">
            הספירה המלאה
          </p>
          <ul className="flex flex-col gap-1.5">
            {scored.map((row) => {
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
                    {/* Wraps rather than truncates: who voted for whom is the
                        whole point of this screen. */}
                    <span className="niqqud block text-xs leading-snug text-slate-400">
                      {voters.join(' · ')}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>

          {unscored.length > 0 && (
            <p className="niqqud pt-2 text-xs leading-relaxed text-slate-600">
              ללא הצבעות:{' '}
              {unscored.map((row) => playerById(state, row.playerId).name).join(' · ')}
            </p>
          )}
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
