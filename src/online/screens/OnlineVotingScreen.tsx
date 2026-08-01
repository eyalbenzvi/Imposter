import { useState } from 'react';
import { Screen, ScreenBody, ScreenHeader } from '../../ui/components/Screen';
import { WaitingPanel } from '../components/WaitingPanel';
import type { GameScreenProps } from './props';

/**
 * Everybody votes at once, in private, on their own phone.
 *
 * This is the biggest change from the single-device game and the clearest win:
 * no passing, no waiting your turn, and nobody looking over a shoulder. The
 * secrecy is stronger too — the host holds the votes in a buffer that never
 * reaches the reducer until the last one is in, and the counter the room sees
 * is a number, never a list of who has already decided.
 */
export function OnlineVotingScreen({ view, send }: GameScreenProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';
  const runoff = view.voteStage === 'RUNOFF';

  const eyebrow = runoff ? 'הצבעה חוזרת' : `סבב ${view.roundNumber}`;

  if (!view.you.alive) {
    return (
      <Screen>
        <ScreenHeader eyebrow={eyebrow} title="הצבעה" />
        <ScreenBody>
          <p className="text-center text-base leading-relaxed text-slate-400">
            הודחתם ואינכם מצביעים בסבב הזה
          </p>
          {view.waiting && <WaitingPanel waiting={view.waiting} />}
        </ScreenBody>
      </Screen>
    );
  }

  if (view.youVoted) {
    return (
      <Screen>
        <ScreenHeader eyebrow={eyebrow} title="הצבעה" />
        <ScreenBody>
          <p
            className="niqqud font-display font-black text-slate-50"
            style={{ fontSize: 'clamp(1.8rem, 9vw, 2.6rem)' }}
          >
            ההצבעה נקלטה
          </p>
          <p className="max-w-[26ch] text-center text-base leading-relaxed text-slate-400">
            הספירה תיחשף לכולם ברגע שכולם יצביעו
          </p>
          {view.waiting && <WaitingPanel waiting={view.waiting} />}
        </ScreenBody>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader eyebrow={eyebrow} title="למי אתם מצביעים?" />

      <ScreenBody className="justify-start">
        {runoff && (
          <p className="shrink-0 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-center text-sm text-gold">
            תיקו — מצביעים שוב, רק בין {view.voteTargets.length} המובילים
          </p>
        )}

        <ul className="grid w-full min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2 overflow-y-auto">
          {view.voteTargets.map((id) => {
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
                  {nameOf(id)}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="w-full shrink-0">
          <button
            type="button"
            disabled={picked === null}
            onClick={() => picked && send({ t: 'VOTE', target: picked })}
            className="btn-primary w-full text-xl"
          >
            {picked ? `להצביע ל${nameOf(picked)}` : 'בחרו שחקן'}
          </button>
          <p className="pt-2 text-center text-xs text-slate-500">
            אחרי הלחיצה ההצבעה נסגרת ואי אפשר לשנות
          </p>
        </div>
      </ScreenBody>
    </Screen>
  );
}
