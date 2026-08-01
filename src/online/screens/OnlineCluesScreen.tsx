import { useEffect, useRef, useState } from 'react';
import {
  Screen,
  ScreenBody,
  ScreenFooter,
  ScreenHeader,
} from '../../ui/components/Screen';
import { MAX_CLUE_LENGTH } from '../protocol';
import { DeadlineBar } from '../components/DeadlineBar';
import { PlayerChips } from '../components/PlayerChips';
import type { GameScreenProps } from './props';

/**
 * Both clue modes, on everybody's phone at once.
 *
 * SPEAK is unchanged in spirit — the app tracks whose turn it is while people
 * talk — except that now the turn strip is on every screen and only the current
 * speaker gets the button.
 *
 * TYPE stays turn-by-turn by choice: the group hears the clues in an order, and
 * everybody typing at once would lose that. What multi-device buys here is
 * privacy — nobody hands over a phone with a half-typed clue on it.
 */
export function OnlineCluesScreen(props: GameScreenProps) {
  return props.view.settings.clueMode === 'SPEAK' ? (
    <SpeakingRound {...props} />
  ) : (
    <TypingRound {...props} />
  );
}

function nameOf(view: GameScreenProps['view'], id: string | null): string {
  return view.players.find((p) => p.id === id)?.name ?? '';
}

function Header({ view }: { view: GameScreenProps['view'] }) {
  return <ScreenHeader eyebrow={`סבב ${view.roundNumber}`} title="סבב רמזים" />;
}

function TurnStrip({ view }: { view: GameScreenProps['view'] }) {
  const inOrder = view.turnOrder
    .map((id) => view.players.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);
  return <PlayerChips players={inOrder} highlight={view.currentPlayerId} />;
}

function SpeakingRound({ view, send }: GameScreenProps) {
  const current = nameOf(view, view.currentPlayerId);
  const at = view.currentPlayerId ? view.turnOrder.indexOf(view.currentPlayerId) : -1;
  const remaining = at === -1 ? view.turnOrder.length : view.turnOrder.length - at;

  return (
    <Screen>
      <Header view={view} />

      <ScreenBody className="justify-between">
        <div className="w-full shrink-0">
          <TurnStrip view={view} />
        </div>

        <div className="flex min-h-0 flex-1 animate-slide-from-end flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm tracking-[0.03em] text-glow/70">
            {view.isYourTurn ? 'התור שלך' : 'התור של'}
          </p>
          <p
            className="niqqud font-display font-black text-slate-50"
            style={{ fontSize: 'clamp(2.6rem, 14vw, 4.5rem)' }}
          >
            {view.isYourTurn ? 'עכשיו אתם' : current}
          </p>
          {!view.isYourTurn && (
            <p className="max-w-[26ch] pt-2 text-base leading-relaxed text-slate-400">
              הקשיבו לרמז. המסך יתקדם בסוף התור
            </p>
          )}
        </div>

        <div className="w-full max-w-sm shrink-0">
          <DeadlineBar view={view} total={view.settings.clueTimerSeconds} />
        </div>
      </ScreenBody>

      <ScreenFooter>
        {view.isYourTurn ? (
          <button
            type="button"
            onClick={() => send({ t: 'NEXT_TURN' })}
            className="btn-primary w-full text-xl"
          >
            {remaining === 1 ? 'אמרתי — לדיון' : 'אמרתי, הבא בתור'}
          </button>
        ) : (
          <SkipToDiscussion view={view} send={send} />
        )}
      </ScreenFooter>
    </Screen>
  );
}

function TypingRound({ view, send }: GameScreenProps) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  const current = nameOf(view, view.currentPlayerId);

  // A new turn is a blank slate, on every device.
  useEffect(() => {
    setText('');
    if (view.isYourTurn) input.current?.focus();
  }, [view.currentPlayerId, view.isYourTurn]);

  const submit = () => {
    if (text.trim().length === 0) return;
    send({ t: 'CLUE', text });
    setText('');
  };

  return (
    <Screen>
      <Header view={view} />

      <ScreenBody className="justify-start">
        <div className="w-full shrink-0">
          <TurnStrip view={view} />
        </div>

        {view.isYourTurn ? (
          <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-5">
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
              maxLength={MAX_CLUE_LENGTH}
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="done"
              dir="rtl"
              className="niqqud w-full rounded-2xl border-2 border-ink-600 bg-ink-850 px-4 py-4 text-center font-display text-3xl text-slate-50 outline-none transition placeholder:text-slate-600 focus:border-glow focus:bg-ink-800"
            />
          </div>
        ) : (
          <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 text-center">
            <p
              className="niqqud font-display font-black text-slate-50"
              style={{ fontSize: 'clamp(2rem, 11vw, 3.2rem)' }}
            >
              {current}
            </p>
            <p className="max-w-[26ch] text-base leading-relaxed text-slate-400">
              מקליד/ה רמז. הרמזים של כולם ייחשפו יחד בסוף הסבב
            </p>
          </div>
        )}
      </ScreenBody>

      <ScreenFooter>
        {view.isYourTurn ? (
          <button
            type="button"
            onClick={submit}
            disabled={text.trim().length === 0}
            className="btn-primary w-full text-xl"
          >
            שלחו את הרמז
          </button>
        ) : (
          <SkipToDiscussion view={view} send={send} />
        )}
      </ScreenFooter>
    </Screen>
  );
}

/**
 * The online stand-in for the single-device "skip to discussion" link. It takes
 * a majority rather than one tap, because here nobody is holding the device on
 * everyone's behalf.
 */
function SkipToDiscussion({ view, send }: GameScreenProps) {
  const waiting = view.waiting;
  const asked = waiting?.youDone ?? false;
  return (
    <button
      type="button"
      disabled={asked || !view.you.alive}
      onClick={() => send({ t: 'SKIP_CLUES' })}
      className="btn-ghost w-full disabled:opacity-40"
    >
      {asked
        ? `ביקשתם לדלג לדיון · ${waiting?.done ?? 0} / ${waiting?.needed ?? 0}`
        : 'אפשר לדלג לדיון'}
    </button>
  );
}
