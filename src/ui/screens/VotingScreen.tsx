import { useEffect, useState } from 'react';
import { currentVoter, playerById, voteTargetsFor } from '../../game/rules';
import { ExitButton } from '../components/ExitButton';
import { PassDevice } from '../components/PassDevice';
import { Screen, ScreenBody, ScreenHeader } from '../components/Screen';
import type { Game } from '../useGame';

/**
 * Votes are cast one player at a time and stay hidden until the last one is in
 * — the state itself holds no partial tally the UI could leak.
 */
export function VotingScreen({ game }: { game: Game }) {
  const { state, dispatch } = game;
  const voter = currentVoter(state);
  const [handed, setHanded] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    setHanded(false);
    setPicked(null);
  }, [voter]);

  if (!voter) return null;
  const player = playerById(state, voter);
  const targets = voteTargetsFor(state, voter);
  const runoff = state.voteStage === 'RUNOFF';

  if (!handed) {
    return (
      <Screen>
        <ScreenHeader
          eyebrow={runoff ? 'הצבעה חוזרת' : `סבב ${state.roundNumber}`}
          title="הצבעה"
          action={<ExitButton game={game} />}
        />
        <PassDevice
          key={voter}
          name={player.name}
          hint={
            runoff
              ? 'תיקו — מצביעים שוב, הפעם רק בין המובילים'
              : 'ההצבעה חסויה. הספירה תיחשף רק כשכולם יצביעו'
          }
          cta="זה אני, אני מצביע"
          progress={`${state.voterIndex + 1} / ${state.voterOrder.length} מצביעים`}
          onContinue={() => setHanded(true)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        eyebrow={`${state.voterIndex + 1} / ${state.voterOrder.length}`}
        title={`${player.name} — למי אתם מצביעים?`}
      />

      <ScreenBody className="justify-start">
        {runoff && (
          <p className="shrink-0 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-center text-sm text-gold">
            הצבעה חוזרת בין {state.eligibleTargets.length} המובילים
          </p>
        )}

        <ul className="grid w-full min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2 overflow-y-auto">
          {targets.map((id) => {
            const active = picked === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setPicked(id)}
                  aria-pressed={active}
                  className={`niqqud flex h-full min-h-[68px] w-full items-center justify-center rounded-2xl border-2 px-3 py-3 text-center text-xl font-bold transition active:scale-[0.97] ${
                    active
                      ? 'border-danger bg-danger/15 text-danger'
                      : 'border-ink-600 bg-ink-850/70 text-slate-200'
                  }`}
                >
                  {playerById(state, id).name}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="w-full shrink-0">
          <button
            type="button"
            disabled={picked === null}
            onClick={() =>
              picked && dispatch({ type: 'CAST_VOTE', voter, target: picked })
            }
            className="btn-primary w-full text-xl"
          >
            {picked
              ? `להצביע ל${playerById(state, picked).name}`
              : 'בחרו שחקן'}
          </button>
          <p className="pt-2 text-center text-xs text-slate-500">
            אחרי הלחיצה ההצבעה נסגרת ואי אפשר לשנות
          </p>
        </div>
      </ScreenBody>
    </Screen>
  );
}
