import { RevealCard } from '../../ui/components/RevealCard';
import { Screen, ScreenBody, ScreenHeader } from '../../ui/components/Screen';
import { WaitingPanel } from '../components/WaitingPanel';
import type { GameScreenProps } from './props';

/**
 * The moment multi-device pays for itself: nobody passes anything. Every player
 * uncovers their own word on their own phone, at the same time.
 *
 * The hold-to-reveal card is reused untouched. It is still worth having — the
 * people next to you can see your screen — and reusing it means the reveal has
 * exactly the same feel, and the same guarantees, in both modes.
 */
export function OnlineRevealScreen({ view, send }: GameScreenProps) {
  const done = view.waiting?.youDone ?? false;

  return (
    <Screen>
      <ScreenHeader eyebrow="חלוקת תפקידים" title="המילה שלכם" />

      {done ? (
        <ScreenBody>
          <p
            className="niqqud font-display font-black text-slate-50"
            style={{ fontSize: 'clamp(1.8rem, 9vw, 2.6rem)' }}
          >
            ראיתם את המילה
          </p>
          <p className="max-w-[26ch] text-center text-base leading-relaxed text-slate-400">
            אל תגלו אותה לאף אחד. המשחק ימשיך כשכולם יהיו מוכנים
          </p>
          {view.waiting && <WaitingPanel waiting={view.waiting} />}
        </ScreenBody>
      ) : (
        view.reveal && (
          <RevealCard
            view={view.reveal}
            position={view.waiting ? view.waiting.done + 1 : 1}
            total={view.waiting?.total ?? view.players.length}
            onHide={() => send({ t: 'READY' })}
          />
        )
      )}
    </Screen>
  );
}
